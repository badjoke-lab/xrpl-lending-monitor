import { writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

import { arg, d1Query, integerArg, requiredArg } from './overlay-checkpoint/common.mjs'

const PREFIX = 'gzip-base64-v1:'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
const databaseId = requiredArg('--database-id')
const outputPath = requiredArg('--output')
const summaryPath = requiredArg('--summary')
const pageSize = integerArg('--page-size', 8, 1, 32)
const network = arg('--network', 'devnet')

if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')
if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required')
if (network !== 'devnet') throw new Error('Fast-lane object lookup backfill is Devnet-only')

function decodeBundle(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('History bundle is empty')
  if (!value.startsWith(PREFIX)) return JSON.parse(value)
  return JSON.parse(gunzipSync(Buffer.from(value.slice(PREFIX.length), 'base64')).toString('utf8'))
}

function lookupJson(bundle) {
  if (!bundle || !Array.isArray(bundle.objectChanges)) {
    throw new Error('History bundle does not contain objectChanges')
  }
  const objects = new Map()
  for (const change of bundle.objectChanges) {
    if (typeof change.objectType !== 'string' || typeof change.objectId !== 'string') {
      throw new Error('History object change lookup identity is invalid')
    }
    objects.set(`${change.objectType}:${change.objectId}`, {
      objectType: change.objectType,
      objectId: change.objectId,
    })
  }
  return JSON.stringify([...objects.values()])
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

const client = { accountId, apiToken, databaseId }
let cursor = 0
const statements = []
let windowCount = 0
let objectReferenceCount = 0
let nonEmptyWindowCount = 0
let firstLedger = null
let lastLedger = null

while (true) {
  const { rows } = await d1Query(client, `
    SELECT lookup.epoch_id,
           lookup.window_start_close_time,
           lookup.start_ledger_index,
           lookup.end_ledger_index,
           history.bundle_json
    FROM fast_lane_shadow_windows AS lookup
    JOIN fast_lane_history_windows AS history
      ON history.network = lookup.network
     AND history.start_ledger_index = lookup.start_ledger_index
     AND history.end_ledger_index = lookup.end_ledger_index
    WHERE lookup.network = 'devnet'
      AND lookup.epoch_id = 'fast-lane-shadow-devnet'
      AND history.epoch_id = (
        SELECT base_epoch_id
        FROM fast_lane_shadow_base_binding
        WHERE network = 'devnet'
      )
      AND lookup.start_ledger_index > ?1
    ORDER BY lookup.start_ledger_index ASC
    LIMIT ?2
  `, [cursor, pageSize])
  if (rows.length === 0) break

  for (const row of rows) {
    const startLedger = Number(row.start_ledger_index)
    const endLedger = Number(row.end_ledger_index)
    const windowStartCloseTime = Number(row.window_start_close_time)
    if (!Number.isSafeInteger(startLedger) || !Number.isSafeInteger(endLedger)) {
      throw new Error('Fast-lane window ledger range is invalid')
    }
    if (!Number.isSafeInteger(windowStartCloseTime)) {
      throw new Error('Fast-lane window close time is invalid')
    }
    const lookup = lookupJson(decodeBundle(row.bundle_json))
    const count = JSON.parse(lookup).length
    statements.push(
      `UPDATE fast_lane_shadow_windows SET object_lookup_json=${sqlText(lookup)} `
      + `WHERE network='devnet' AND epoch_id=${sqlText(row.epoch_id)} `
      + `AND window_start_close_time=${windowStartCloseTime} `
      + `AND start_ledger_index=${startLedger} AND end_ledger_index=${endLedger};`,
    )
    windowCount += 1
    objectReferenceCount += count
    if (count > 0) nonEmptyWindowCount += 1
    firstLedger = firstLedger ?? startLedger
    lastLedger = endLedger
    cursor = startLedger
  }
}

if (windowCount === 0) throw new Error('No retained fast-lane windows were available for backfill')
writeFileSync(outputPath, `${statements.join('\n')}\n`)
writeFileSync(summaryPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  network,
  windowCount,
  nonEmptyWindowCount,
  objectReferenceCount,
  firstLedger,
  lastLedger,
}, null, 2)}\n`)
