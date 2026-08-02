import {
  buildPortableXrplNormalizedWork,
  portableReferenceRowsFromChunk,
  type PortablePersistedReferenceRowV1,
} from '../../../src/collector/history-segments/portable-xrpl-normalization'
import { isLendingTransactionType } from '../../../src/collector/incremental/lending-transaction-types'
import type { IncrementalScanResult } from '../../../src/collector/incremental/scan-validated-ledgers'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from '../../../src/collector/incremental/validated-ledger-parser'
import { canonicalPortableJson } from '../../../src/shared/portable-collector-reference-store'

const SET_ID = 'r4c2c-devnet-historical-witness-v1'
const PROFILE_ID = 'supabase-devnet-historical-witness'
const EPOCH_ID = 'supabase-r4c2c-historical-witness-v1'
const BASE_IDENTITY = 'historical-witness-2776760-2980845-3127240'
const PURPOSE = 'r4c2c-historical-witness-qualification'
const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234/'
const REQUEST_TIMEOUT_MILLISECONDS = 15_000

const LEDGERS = [
  {
    ledgerIndex: 2_776_760,
    ledgerHash: '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D',
    parentHash: 'E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628',
  },
  {
    ledgerIndex: 2_980_845,
    ledgerHash: '5BA95992F3E649752BBA5550EEEF79DEB535881E10FF7C1D4F9EF953340B0C40',
    parentHash: 'F193C199E54799140F552EF7F6D16FEFED39CF3F06799F25A34BE7D9791A9A81',
  },
  {
    ledgerIndex: 3_127_240,
    ledgerHash: '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3',
    parentHash: '072DEDC596274E711A246F93F7919100A16473D549AEA2C3CE4B7D2233BF903E',
  },
] as const

const EXPECTED_COUNTS = {
  'validated-ledger': 3,
  'protocol-event': 13,
  'object-change': 197,
  'loan-lifecycle': 3,
  'archived-object': 1,
  'balance-history': 2,
  'current-projection': 18,
} as const

type Json = Record<string, unknown>
type SemanticClass = keyof typeof EXPECTED_COUNTS

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function serviceKey(): string {
  const packed = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (packed) {
    const parsed = JSON.parse(packed) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

function authorized(request: Request, key: string): boolean {
  const authorization = request.headers.get('authorization')
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
  return bearer === key || request.headers.get('apikey') === key
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)))
}

async function readLedger(
  endpoint: string,
  expected: (typeof LEDGERS)[number],
): Promise<ValidatedLedgerRead> {
  const result = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'ledger',
      params: [
        {
          ledger_index: expected.ledgerIndex,
          transactions: true,
          expand: true,
          owner_funds: false,
        },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  })
  if (!result.ok) throw new Error(`Devnet ledger ${expected.ledgerIndex} returned HTTP ${result.status}`)
  const payload = await result.json()
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error(`Devnet ledger ${expected.ledgerIndex} did not return a result object`)
  }
  if (typeof payload.result.error === 'string') {
    throw new Error(
      `Devnet ledger ${expected.ledgerIndex} failed: ${payload.result.error_message ?? payload.result.error}`,
    )
  }
  const ledger = parseValidatedLedgerResult({
    endpoint,
    requestedLedgerIndex: expected.ledgerIndex,
    result: payload.result,
  })
  if (
    ledger.ledgerHash !== expected.ledgerHash ||
    ledger.parentHash !== expected.parentHash
  ) {
    throw new Error(`Devnet ledger ${expected.ledgerIndex} identity changed`)
  }
  return ledger
}

function singleLedgerScan(ledger: ValidatedLedgerRead): IncrementalScanResult {
  const lendingTransactions = ledger.transactions.filter((transaction) =>
    isLendingTransactionType(transaction.transactionType),
  )
  return {
    endpoint: ledger.endpoint,
    startLedgerIndex: ledger.ledgerIndex,
    endLedgerIndex: ledger.ledgerIndex,
    latestValidatedLedger: ledger.ledgerIndex,
    completeToLatest: true,
    ledgers: [{ ...ledger, lendingTransactions }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: ledger.transactions.length,
      lendingTransactions: lendingTransactions.length,
      elapsedMs: 0,
    },
  }
}

function compareRows(
  left: PortablePersistedReferenceRowV1,
  right: PortablePersistedReferenceRowV1,
): number {
  return (
    left.sourceLedgerIndex - right.sourceLedgerIndex ||
    left.semanticClass.localeCompare(right.semanticClass) ||
    left.canonicalKey.localeCompare(right.canonicalKey)
  )
}

function countRows(rows: readonly PortablePersistedReferenceRowV1[]): Record<SemanticClass, number> {
  const counts: Record<SemanticClass, number> = {
    'validated-ledger': 0,
    'protocol-event': 0,
    'object-change': 0,
    'loan-lifecycle': 0,
    'archived-object': 0,
    'balance-history': 0,
    'current-projection': 0,
  }
  for (const row of rows) counts[row.semanticClass] += 1
  return counts
}

function verifyRows(rows: readonly PortablePersistedReferenceRowV1[]): Record<SemanticClass, number> {
  if (rows.length !== 237) throw new Error(`Historical witness produced ${rows.length} rows, expected 237`)
  const identities = new Set<string>()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const identity = `${row.semanticClass}\u0000${row.canonicalKey}`
    if (identities.has(identity)) throw new Error(`Duplicate historical witness row: ${identity}`)
    identities.add(identity)
    if (index > 0 && compareRows(rows[index - 1]!, row) >= 0) {
      throw new Error('Historical witness rows are not in canonical order')
    }
    const canonicalRelationships = [...new Set(row.relationshipIds)].sort((left, right) =>
      left.localeCompare(right),
    )
    if (canonicalPortableJson(canonicalRelationships) !== canonicalPortableJson(row.relationshipIds)) {
      throw new Error(`Historical witness relationships are not canonical: ${identity}`)
    }
    if (row.semanticClass === 'current-projection' && row.isTombstone && row.valueJson !== null) {
      throw new Error(`Historical projection tombstone exposes a value: ${identity}`)
    }
  }
  const counts = countRows(rows)
  if (canonicalPortableJson(counts) !== canonicalPortableJson(EXPECTED_COUNTS)) {
    throw new Error(`Historical witness semantic counts changed: ${canonicalPortableJson(counts)}`)
  }
  return counts
}

async function commitWitness(
  supabaseUrl: string,
  key: string,
  recordsJson: string,
  recordsDigest: string,
): Promise<Json> {
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/xrpl_commit_historical_witness`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_set_id: SET_ID,
      p_records_json: recordsJson,
      p_records_digest: recordsDigest,
      p_committed_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await result.text()
  if (!result.ok) throw new Error(`Historical witness commit failed (${result.status}): ${text.slice(0, 500)}`)
  const parsed = JSON.parse(text)
  if (!isRecord(parsed) || parsed.committed !== true || parsed.recordCount !== 237) {
    throw new Error('Historical witness commit returned an invalid result')
  }
  return parsed
}

async function execute(): Promise<Json> {
  const endpoint = Deno.env.get('XRPL_DEVNET_RPC_URL')?.trim() || DEFAULT_ENDPOINT
  const ledgers = await Promise.all(LEDGERS.map((expected) => readLedger(endpoint, expected)))
  const rows: PortablePersistedReferenceRowV1[] = []
  for (const ledger of ledgers) {
    const normalized = await buildPortableXrplNormalizedWork({
      scan: singleLedgerScan(ledger),
      workId: `historical-witness:${ledger.ledgerIndex}:${ledger.ledgerHash}`,
      network: 'devnet',
      epochId: EPOCH_ID,
      baseIdentity: BASE_IDENTITY,
      previousLedgerIndex: ledger.ledgerIndex - 1,
      expectedParentHash: ledger.parentHash,
    })
    for (const chunk of normalized.chunks) {
      rows.push(...portableReferenceRowsFromChunk(chunk.chunk))
    }
  }
  rows.sort(compareRows)
  const semanticCounts = verifyRows(rows)
  const recordsJson = canonicalPortableJson(rows)
  const recordsDigest = await sha256(recordsJson)
  const commit = await commitWitness(env('SUPABASE_URL'), serviceKey(), recordsJson, recordsDigest)
  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    profileId: PROFILE_ID,
    epochId: EPOCH_ID,
    baseIdentity: BASE_IDENTITY,
    setId: SET_ID,
    sourceLedgers: LEDGERS.map(({ ledgerIndex, ledgerHash }) => ({ ledgerIndex, ledgerHash })),
    recordCount: rows.length,
    semanticCounts,
    recordsDigest: `sha256:${recordsDigest}`,
    commit,
  }
}

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)
    const key = serviceKey()
    if (!authorized(request, key)) return response({ error: 'unauthorized' }, 401)
    return response(await execute())
  } catch (error) {
    return response(
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
      },
      500,
    )
  }
})
