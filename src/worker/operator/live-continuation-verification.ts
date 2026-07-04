import {
  evaluateLiveContinuationEvidence,
  type LiveContinuationVerificationReport,
} from '../../collector/incremental/live-continuation-verification'
import { readLiveContinuationEvidence } from '../repositories/live-continuation-verification'

export async function verifyLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationVerificationReport> {
  const evidence = await readLiveContinuationEvidence(db)
  return evaluateLiveContinuationEvidence(evidence)
}
