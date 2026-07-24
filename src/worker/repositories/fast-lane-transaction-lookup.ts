import type {
  ObjectChangeRecord,
  ProtocolEventRecord,
} from './history-api-repository'
import type { FastLaneHistoryBundle } from './fast-lane-history-window'

const INITIAL_PREFIX_LENGTH = 2
export const MAX_FAST_LANE_TRANSACTION_LOOKUP_SHARD_BYTES = 96 * 1024
const MAX_LOOKUP_ROWS = 256

export interface FastLaneTransactionLookupValue {
  event: ProtocolEventRecord | null
  changes: ObjectChangeRecord[]
}

export interface FastLaneTransactionLookupShard {
  shardPrefix: string
  payloadJson: string
  payloadBytes: number
  transactionCount: number
}

interface LookupShardRow {
  payload_json: string
}

interface LookupPayload {
  schemaVersion: 1
  transactions: Record<string, FastLaneTransactionLookupValue>
}

function normalizedHash(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error('Fast-lane transaction lookup hash is invalid')
  }
  return normalized
}

function payload(entries: readonly [string, FastLaneTransactionLookupValue][]): {
  json: string
  bytes: number
} {
  const value: LookupPayload = {
    schemaVersion: 1,
    transactions: Object.fromEntries(entries),
  }
  const json = JSON.stringify(value)
  return { json, bytes: new TextEncoder().encode(json).byteLength }
}

function partitionEntries(
  entries: readonly [string, FastLaneTransactionLookupValue][],
  prefixLength: number,
): FastLaneTransactionLookupShard[] {
  const groups = new Map<string, [string, FastLaneTransactionLookupValue][]>()
  for (const entry of entries) {
    const prefix = entry[0].slice(0, prefixLength)
    const group = groups.get(prefix) ?? []
    group.push(entry)
    groups.set(prefix, group)
  }

  const shards: FastLaneTransactionLookupShard[] = []
  for (const [prefix, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const encoded = payload(group)
    if (encoded.bytes <= MAX_FAST_LANE_TRANSACTION_LOOKUP_SHARD_BYTES) {
      shards.push({
        shardPrefix: prefix,
        payloadJson: encoded.json,
        payloadBytes: encoded.bytes,
        transactionCount: group.length,
      })
      continue
    }
    if (prefixLength >= 64 || group.length === 1) {
      throw new Error(
        `Fast-lane transaction lookup shard exceeds the persistence limit: prefix=${prefix}, bytes=${encoded.bytes}, limit=${MAX_FAST_LANE_TRANSACTION_LOOKUP_SHARD_BYTES}`,
      )
    }
    shards.push(...partitionEntries(group, prefixLength + 1))
  }
  return shards
}

export function buildFastLaneTransactionLookupShards(
  bundle: FastLaneHistoryBundle,
): FastLaneTransactionLookupShard[] {
  const transactions = new Map<string, FastLaneTransactionLookupValue>()
  for (const event of bundle.protocolEvents) {
    const hash = normalizedHash(event.eventHash)
    const current = transactions.get(hash)
    transactions.set(hash, {
      event,
      changes: current?.changes ?? [],
    })
  }
  for (const change of bundle.objectChanges) {
    const hash = normalizedHash(change.transactionHash)
    const current = transactions.get(hash) ?? { event: null, changes: [] }
    current.changes.push(change)
    transactions.set(hash, current)
  }

  const entries = [...transactions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hash, value]) => [
      hash,
      {
        event: value.event,
        changes: [...value.changes].sort((left, right) => (
          left.nodeIndex - right.nodeIndex || left.fieldName.localeCompare(right.fieldName)
        )),
      },
    ] as [string, FastLaneTransactionLookupValue])
  return entries.length === 0 ? [] : partitionEntries(entries, INITIAL_PREFIX_LENGTH)
}

function parsePayload(value: string): LookupPayload {
  const parsed = JSON.parse(value) as Partial<LookupPayload>
  if (
    parsed.schemaVersion !== 1
    || !parsed.transactions
    || typeof parsed.transactions !== 'object'
    || Array.isArray(parsed.transactions)
  ) {
    throw new Error('Fast-lane transaction lookup payload is invalid')
  }
  return parsed as LookupPayload
}

export async function getFastLaneTransactionDetail(
  db: D1Database,
  transactionHash: string,
): Promise<FastLaneTransactionLookupValue | null> {
  const hash = normalizedHash(transactionHash)
  const prefixes = Array.from(
    { length: 64 - INITIAL_PREFIX_LENGTH + 1 },
    (_, index) => hash.slice(0, INITIAL_PREFIX_LENGTH + index),
  )
  const placeholders = prefixes.map((_, index) => `?${index + 1}`).join(', ')
  const rows = await db.prepare(
    `SELECT payload_json
     FROM fast_lane_transaction_lookup_shards
     WHERE network = 'devnet'
       AND epoch_id = (
         SELECT base_epoch_id
         FROM fast_lane_shadow_base_binding
         WHERE network = 'devnet'
       )
       AND shard_prefix IN (${placeholders})
     ORDER BY end_ledger_index DESC
     LIMIT ?${prefixes.length + 1}`,
  ).bind(...prefixes, MAX_LOOKUP_ROWS).all<LookupShardRow>()

  for (const row of rows.results ?? []) {
    const found = parsePayload(row.payload_json).transactions[hash]
    if (found) return found
  }
  return null
}
