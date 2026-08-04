import { existsSync, readFileSync } from 'node:fs'

const successPath =
  'supabase-r5-recovery-burst-evidence/verified-r5-recovery-burst.json'
const failurePath =
  'supabase-r5-recovery-burst-evidence/failed-r5-recovery-burst-verification.json'

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function code(value) {
  const rendered = value === undefined || value === null ? 'null' : String(value)
  return `\`${rendered.replaceAll('`', "'")}\``
}

function watermark(value = {}) {
  return `${code(value.ledgerIndex)} / ${code(value.ledgerHash)} / ${code(value.workId)}`
}

if (existsSync(successPath)) {
  const evidence = read(successPath)
  const before = evidence.before ?? {}
  const after = evidence.after ?? {}
  const boundary = evidence.activeBoundary ?? {}
  const checks = evidence.checks ?? {}
  const batches = Array.isArray(evidence.batches) ? evidence.batches : []
  const first = batches.at(0) ?? {}
  const last = batches.at(-1) ?? {}
  const totalBatchLedgers = batches.reduce(
    (sum, batch) => sum + Number(batch?.ledgerCount ?? 0),
    0,
  )

  process.stdout.write(`## R5 bounded active recovery burst

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- burst verifier: ${code('success')}
- recovery run ID: ${code(evidence.recoveryRunId)}
- requested batch limit: ${code(evidence.requestedBatchLimit)}
- wall-clock bound seconds: ${code(evidence.wallSeconds)}
- elapsed milliseconds: ${code(evidence.elapsedMilliseconds)}
- stop reason: ${code(evidence.stopReason)}
- transient retries: ${code(evidence.transientRetries)}
- completed batches in burst: ${code(batches.length)}
- committed ledgers in burst: ${code(totalBatchLedgers)}
- first burst batch sequence: ${code(first.batchSequence)}
- first burst ledger range: ${code(first.startLedgerIndex)} → ${code(first.endLedgerIndex)}
- last burst batch sequence: ${code(last.batchSequence)}
- last burst ledger range: ${code(last.startLedgerIndex)} → ${code(last.endLedgerIndex)}
- recovery status before: ${code(before.status)}
- completed batches before: ${code(before.completedBatches)}
- committed ledgers before: ${code(before.committedLedgers)}
- active watermark before: ${watermark(before.currentWatermark)}
- recovery status after: ${code(after.status)}
- completed batches after: ${code(after.completedBatches)}
- committed ledgers after: ${code(after.committedLedgers)}
- active watermark after: ${watermark(after.currentWatermark)}
- current validated head: ${code(after.currentValidatedHead?.ledgerIndex)}
- current observed lag: ${code(after.currentObservedLag)}
- pending scan count: ${code(boundary.pendingCount)}
- leased message count: ${code(boundary.leasedCount)}
- retry message count: ${code(boundary.retryCount)}
- in-flight work count: ${code(boundary.inflightWorkCount)}
- exact batch advance: ${code(checks.exactBatchAdvance)}
- exact ledger advance: ${code(checks.exactLedgerAdvance)}
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
  process.stdout.write(`## R5 bounded active recovery burst

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- burst verifier: ${code('failed')}
- recovery run ID: ${code(evidence.recoveryRunId)}
- requested batch limit: ${code(evidence.requestedBatchLimit)}
- wall-clock bound seconds: ${code(evidence.wallSeconds)}
- reason: ${code(evidence.error)}
- burst completed: ${code(checks.burstCompleted)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
}
