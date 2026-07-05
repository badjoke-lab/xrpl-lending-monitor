import {
  evaluateLiveContinuationEvidence,
  type LiveContinuationEvidence,
  type LiveContinuationVerificationReport,
} from '../../collector/incremental/live-continuation-verification'
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
}

export async function diagnoseLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationDiagnostics> {
  const evidence = await readLiveContinuationEvidence(db)
  return {
    evidence,
    report: evaluateLiveContinuationEvidence(evidence),
  }
}
