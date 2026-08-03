import { existsSync, readFileSync } from 'node:fs'

const successPath = 'supabase-remote-probe-evidence/verified-r5-recovery-prepare.json'
const failurePath =
  'supabase-remote-probe-evidence/failed-r5-recovery-prepare-verification.json'

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function code(value) {
  return `\`${String(value)}\``
}

if (existsSync(successPath)) {
  const evidence = read(successPath)
  const checkpoint = evidence.checkpointWatermark ?? {}
  const start = evidence.startWatermark ?? {}
  const initialHead = evidence.initialValidatedHead ?? {}
  const currentHead = evidence.currentValidatedHead ?? {}
  const checks = evidence.checks ?? {}
  process.stdout.write(`## R5 Supabase recovery preparation

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- preparation verifier: ${code('success')}
- recovery run ID: ${code(evidence.runId)}
- checkpoint ID: ${code(evidence.checkpointId)}
- recovery prepared in this run: ${code(evidence.preparedNow)}
- status: ${code(evidence.status)}
- profile: ${code(evidence.profileId)}
- revision: ${code(evidence.profileRevision)}
- profile identity digest: ${code(evidence.profileIdentityDigest)}
- R4E selection digest: ${code(evidence.selectionDigest)}
- checkpoint state digest: ${code(evidence.checkpointStateDigest)}
- checkpoint watermark ledger: ${code(checkpoint.ledgerIndex)}
- active start watermark ledger: ${code(start.ledgerIndex)}
- active start watermark hash: ${code(start.ledgerHash)}
- active start watermark work: ${code(start.workId)}
- checkpoint-to-start ledgers: ${code(evidence.checkpointToStartLedgers)}
- descendant committed works: ${code(evidence.descendantWorkCount)}
- initial validated head: ${code(initialHead.ledgerIndex)}
- initial lag: ${code(evidence.initialLagLedgers)}
- current validated head: ${code(currentHead.ledgerIndex)}
- current observed lag: ${code(evidence.currentObservedLag)}
- batch size: ${code(evidence.batchSize)}
- checkpoint descendant chain proved: ${code(checks.checkpointDescendantChainProved)}
- one-ledger hash continuity proved: ${code(checks.oneLedgerHashContinuityProved)}
- zero recovery batches committed: ${code(checks.zeroRecoveryBatchesCommitted)}
- active recovery started: ${code(checks.activeRecoveryStarted)}
- R5 recovery authorized: ${code(checks.r5RecoveryAuthorized)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
} else if (existsSync(failurePath)) {
  const evidence = read(failurePath)
  const checks = evidence.checks ?? {}
  process.stdout.write(`## R5 Supabase recovery preparation

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- preparation verifier: ${code('failed')}
- recovery run ID: ${code(evidence.runId)}
- checkpoint ID: ${code(evidence.checkpointId)}
- reason: ${code(evidence.error)}
- active recovery started: ${code(checks.activeRecoveryStarted)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
}
