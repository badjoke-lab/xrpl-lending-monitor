import {
  evaluateM1RuntimeExit,
  type M1RuntimeExitEvidence,
  type M1RuntimeExitReport,
} from '../../collector/incremental/m1-runtime-exit-gate'
import type { CatchUpBaseIdentity } from '../../shared/catch-up-base-identity'
import { readLiveContinuationEvidence } from '../repositories/live-continuation-verification'
import { readLoanActivityDiagnostics } from '../repositories/loan-activity-diagnostics'
import { evaluateLiveContinuationForRuntime } from './live-continuation-verification'

interface BoundBaseRow {
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
}

interface M1RuntimeExitOptions {
  db: D1Database
  expectedBase: CatchUpBaseIdentity | null
}

export interface M1RuntimeExitDiagnostics {
  evidence: M1RuntimeExitEvidence
  report: M1RuntimeExitReport
}

async function readM1RuntimeExitEvidence(
  options: M1RuntimeExitOptions,
): Promise<M1RuntimeExitEvidence> {
  const [liveEvidence, loanActivity, boundBase] = await Promise.all([
    readLiveContinuationEvidence(options.db),
    readLoanActivityDiagnostics(options.db),
    options.db.prepare(
      `SELECT epoch_id, base_snapshot_id, base_ledger_index, base_ledger_hash
       FROM current_state_overlay_state
       WHERE network = 'devnet'
       ORDER BY updated_at DESC
       LIMIT 1`,
    ).first<BoundBaseRow>(),
  ])

  const continuation = evaluateLiveContinuationForRuntime(liveEvidence, loanActivity)

  return {
    expectedBase: {
      epochId: options.expectedBase?.epochId ?? null,
      snapshotId: options.expectedBase?.snapshotId ?? null,
      ledgerIndex: options.expectedBase?.ledgerIndex ?? null,
      ledgerHash: options.expectedBase?.ledgerHash ?? null,
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
