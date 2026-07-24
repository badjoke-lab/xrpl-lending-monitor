import type { Bindings } from '../env'
import { decodeFastLaneHistoryPayload } from '../repositories/fast-lane-history-codec'
import type { FastLaneHistoryBundle } from '../repositories/fast-lane-history-window'
import {
  getTransactionDetail,
  type ObjectChangeRecord,
  type ProtocolEventRecord,
} from '../repositories/history-api-repository'
import { serializeTransactionResponse } from '../serializers/history-api'

interface FastLaneTransactionWindowRow {
  bundle_json: string
}

function transactionPathHash(request: Request): string | null {
  if (request.method !== 'GET') return null
  const match = new URL(request.url).pathname.match(/^\/api\/transactions\/([A-Fa-f0-9]{64})$/)
  return match?.[1]?.toUpperCase() ?? null
}

async function getFastLaneTransactionDetail(
  db: D1Database,
  transactionHash: string,
): Promise<{ event: ProtocolEventRecord | null; changes: ObjectChangeRecord[] } | null> {
  const needle = `\"hash\":\"${transactionHash}\"`
  const row = await db.prepare(
    `SELECT history.bundle_json
     FROM fast_lane_shadow_windows AS activity
     JOIN fast_lane_history_windows AS history
       ON history.network = activity.network
      AND history.start_ledger_index = activity.start_ledger_index
      AND history.end_ledger_index = activity.end_ledger_index
     WHERE activity.network = 'devnet'
       AND activity.epoch_id = 'fast-lane-shadow-devnet'
       AND history.epoch_id = (
         SELECT base_epoch_id
         FROM fast_lane_shadow_base_binding
         WHERE network = 'devnet'
       )
       AND instr(activity.activity_bundle_json, ?1) > 0
     ORDER BY activity.end_ledger_index DESC
     LIMIT 1`,
  ).bind(needle).first<FastLaneTransactionWindowRow>()
  if (!row) return null

  const decoded = await decodeFastLaneHistoryPayload(row.bundle_json) as Partial<FastLaneHistoryBundle>
  if (!Array.isArray(decoded.protocolEvents) || !Array.isArray(decoded.objectChanges)) {
    throw new Error('Fast-lane transaction history bundle is invalid')
  }
  return {
    event: decoded.protocolEvents.find(
      (event) => event.eventHash.toUpperCase() === transactionHash,
    ) ?? null,
    changes: decoded.objectChanges.filter(
      (change) => change.transactionHash.toUpperCase() === transactionHash,
    ),
  }
}

function mergeChanges(
  canonical: readonly ObjectChangeRecord[],
  fastLane: readonly ObjectChangeRecord[],
): ObjectChangeRecord[] {
  const changes = new Map<string, ObjectChangeRecord>()
  for (const change of [...canonical, ...fastLane]) {
    changes.set(
      `${change.transactionHash}:${change.nodeIndex}:${change.fieldName}`,
      change,
    )
  }
  return [...changes.values()].sort((left, right) => (
    left.nodeIndex - right.nodeIndex || left.fieldName.localeCompare(right.fieldName)
  ))
}

export async function handleHybridTransactionDetail(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  const transactionHash = transactionPathHash(request)
  if (!transactionHash) return null

  const [canonical, fastLane] = await Promise.all([
    getTransactionDetail(env.DB, transactionHash),
    getFastLaneTransactionDetail(env.DB, transactionHash),
  ])
  const event = canonical.event ?? fastLane?.event ?? null
  const changes = mergeChanges(canonical.changes, fastLane?.changes ?? [])
  if (!event && changes.length === 0) {
    return Response.json({ error: 'not_found', transaction_hash: transactionHash }, { status: 404 })
  }
  return Response.json(serializeTransactionResponse({
    transactionHash,
    event,
    changes,
  }))
}
