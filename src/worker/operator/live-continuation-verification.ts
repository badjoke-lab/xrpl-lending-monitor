import {
  evaluateLiveContinuationEvidence,
  type LiveContinuationEvidence,
  type LiveContinuationVerificationReport,
} from '../../collector/incremental/live-continuation-verification'
import {
  readLiveContinuationDrilldown,
  type LiveContinuationDrilldown,
} from '../repositories/live-continuation-drilldown'
import { readLiveContinuationEvidence } from '../repositories/live-continuation-verification'

export async function verifyLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationVerificationReport> {
  const evidence = await readLiveContinuationEvidence(db)
  return evaluateLiveContinuationEvidence(evidence)
}

export interface LiveContinuationDiagnostics {
  evidence: LiveContinuationEvidence
  report: LiveContinuationVerificationReport
  drilldown: LiveContinuationDrilldown
}

export async function diagnoseLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationDiagnostics> {
  const [evidence, drilldown] = await Promise.all([
    readLiveContinuationEvidence(db),
    readLiveContinuationDrilldown(db),
  ])
  return {
    evidence,
    report: evaluateLiveContinuationEvidence(evidence),
    drilldown,
  }
}
