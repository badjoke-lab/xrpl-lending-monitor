import { existsSync, readFileSync } from 'node:fs'

const successPath =
  'supabase-remote-probe-evidence/verified-r5-first-recovery-batch.json'
const failurePath =
  'supabase-remote-probe-evidence/failed-r5-first-recovery-batch-verification.json'

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function code(value) {
  return `\`${String(value)}\``
}

if (existsSync(successPath)) {
  const evidence = read(successPath)
  const before = evidence.before ?? {}
  const batch = evidence.batch ?? {}
  const after = evidence.after ?? {}
  const currentWatermark = after.currentWatermark ?? {}
  const currentHead = after.currentValidatedHead ?? {}
  const boundary = evidence.activeBoundary ?? {}
  const checks = evidence.checks ?? {}
  process.stdout.write(`## R5 first active recovery batch

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- first-batch verifier: ${code('success')}
- recovery run ID: ${code(evidence.recoveryRunId)}
- batch ID: ${code(evidence.batchId)}
- executed in this run: ${code(evidence.executedNow)}
- verifier attempt: ${code(evidence.verifierAttempt)}
- transient retries: ${code(evidence.transientRetries)}
- status after verification: ${code(evidence.status)}
- profile: ${code(evidence.profileId)}
- revision: ${code(evidence.profileRevision)}
- profile identity digest: ${code(evidence.profileIdentityDigest)}
- R4E selection digest: ${code(evidence.selectionDigest)}
- completed batches before: ${code(before.completedBatches)}
- committed ledgers before: ${code(before.committedLedgers)}
- batch sequence: ${code(batch.batchSequence)}
- batch start ledger: ${code(batch.startLedgerIndex)}
- batch end ledger: ${code(batch.endLedgerIndex)}
- batch ledger count: ${code(batch.ledgerCount)}
- expected parent hash: ${code(batch.expectedParentHash)}
- final ledger hash: ${code(batch.finalLedgerHash)}
- final work ID: ${code(batch.finalWorkId)}
- works digest: ${code(batch.worksDigest)}
- rows digest: ${code(batch.rowsDigest)}
- accounting digest: ${code(batch.accountingDigest)}
- reserved egress upper bound bytes: ${code(batch.reservedEgressUpperBoundBytes)}
- finalized egress upper bound bytes: ${code(batch.finalizedEgressUpperBoundBytes)}
- attempt count: ${code(batch.attemptCount)}
- completed batches after: ${code(after.completedBatches)}
- committed ledgers after: ${code(after.committedLedgers)}
- current active watermark ledger: ${code(currentWatermark.ledgerIndex)}
- current active watermark hash: ${code(currentWatermark.ledgerHash)}
- current active watermark work: ${code(currentWatermark.workId)}
- current validated head: ${code(currentHead.ledgerIndex)}
- current observed lag: ${code(after.currentObservedLag)}
- pending scan count: ${code(boundary.pendingCount)}
- leased message count: ${code(boundary.leasedCount)}
- retry message count: ${code(boundary.retryCount)}
- in-flight work count: ${code(boundary.inflightWorkCount)}
- first-batch committed works: ${code(boundary.firstBatchCommittedWorkCount)}
- first-batch reference rows: ${code(boundary.firstBatchReferenceRowCount)}
- first batch completed: ${code(checks.firstBatchCompleted)}
- exactly 24 ledgers committed: ${code(checks.exactlyTwentyFourLedgersCommitted)}
- start bound to prepared watermark: ${code(checks.startBoundToPreparedWatermark)}
- hash linked to prepared watermark: ${code(checks.hashLinkedToPreparedWatermark)}
- reservation shrunk only after success: ${code(checks.reservationShrunkOnlyAfterSuccess)}
- revision-3 accounting bound: ${code(checks.revision3AccountingBound)}
- active recovery started: ${code(checks.activeRecoveryStarted)}
- lag zero: ${code(checks.lagZero)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
} else if (existsSync(failurePath)) {
  const evidence = read(failurePath)
  const checks = evidence.checks ?? {}
  process.stdout.write(`## R5 first active recovery batch

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- first-batch verifier: ${code('failed')}
- recovery run ID: ${code(evidence.recoveryRunId)}
- batch ID: ${code(evidence.batchId)}
- reason: ${code(evidence.error)}
- first batch completed: ${code(checks.firstBatchCompleted)}
- active recovery started: ${code(checks.activeRecoveryStarted)}
- lag zero: ${code(checks.lagZero)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
}
