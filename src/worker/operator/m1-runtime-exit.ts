import { evaluateLiveContinuationEvidence } from '../../collector/incremental/live-continuation-verification'
import {
  evaluateM1RuntimeExit,
  type M1RuntimeExitEvidence,
  type M1RuntimeExitReport,
} from '../../collector/incremental/m1-runtime-exit-gate'
import type { RuntimeConfig } from '../../shared/runtime-config'
import { readLiveContinuationEvidence } from '../repositories/live-continuation-verification'
import { resolveCurrentStateStorage } from '../repositories/release-current-state'

interface BoundBaseRow {
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
}

interface M1RuntimeExitOptions {
  db: D1Database
  config: RuntimeConfig
}

export interface M1RuntimeExitDiagnostics {
  evidence: M1RuntimeExitEvidence
  report: M1RuntimeExitReport
}

async function readM1RuntimeExitEvidence(
  options: M1RuntimeExitOptions,
): Promise<M1RuntimeExitEvidence> {
  const [storage, liveEvidence, boundBase] = await Promise.all([
    resolveCurrentStateStorage(options.config, options.db),
    readLiveContinuationEvidence(options.db),
    options.db.prepare(
      `SELECT epoch_id, base_snapshot_id, base_ledger_index, base_ledger_hash
       FROM current_state_overlay_state
       WHERE network = 'devnet'
       ORDER BY updated_at DESC
       LIMIT 1`,
    ).first<BoundBaseRow>(),
  ])

  const snapshot = storage.snapshot
  const continuation = evaluateLiveContinuationEvidence(liveEvidence)

  return {
    expectedBase: {
      epochId: snapshot?.epochId ?? null,
      snapshotId: snapshot?.id ?? null,
      ledgerIndex: snapshot?.ledgerIndex ?? null,
      ledgerHash: snapshot?.ledgerHash ?? null,
    },
    boundBase: {
      epochId: boundBase?.epoch_id ?? null,
      snapshotId: boundBase?.base_snapshot_id ?? null,
      ledgerIndex: boundBase?.base_ledger_index ?? null,
      ledgerHash: boundBase?.base_ledger_hash ?? null,
    },
    processedLedgers: liveEvidence.processedLedgers,
    cursor: liveEvidence.cursor,
    continuation,
  }
}

export async function diagnoseM1RuntimeExit(
  options: M1RuntimeExitOptions,
): Promise<M1RuntimeExitDiagnostics> {
  const evidence = await readM1RuntimeExitEvidence(options)
  return {
    evidence,
    report: evaluateM1RuntimeExit(evidence),
  }
}

export async function reviewM1RuntimeExit(
  options: M1RuntimeExitOptions,
): Promise<M1RuntimeExitReport> {
  const diagnostics = await diagnoseM1RuntimeExit(options)
  return diagnostics.report
}
