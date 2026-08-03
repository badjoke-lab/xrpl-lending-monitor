import { existsSync, readFileSync } from 'node:fs'

const successPath = 'supabase-remote-probe-evidence/verified-r5-active-checkpoint.json'
const failurePath =
  'supabase-remote-probe-evidence/failed-r5-active-checkpoint-verification.json'

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function code(value) {
  return `\`${String(value)}\``
}

if (existsSync(successPath)) {
  const evidence = read(successPath)
  const watermark = evidence.checkpointWatermark ?? {}
  const head = evidence.validatedHead ?? {}
  const checks = evidence.checks ?? {}
  process.stdout.write(`## R5 Supabase active checkpoint

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- checkpoint verifier: ${code('success')}
- checkpoint ID: ${code(evidence.checkpointId)}
- checkpoint created in this run: ${code(evidence.createdNow)}
- profile: ${code(evidence.profileId)}
- revision: ${code(evidence.profileRevision)}
- profile identity digest: ${code(evidence.profileIdentityDigest)}
- R4E selection digest: ${code(evidence.selectionDigest)}
- checkpoint watermark ledger: ${code(watermark.ledgerIndex)}
- checkpoint watermark hash: ${code(watermark.ledgerHash)}
- checkpoint watermark work: ${code(watermark.workId)}
- validated Devnet head: ${code(head.ledgerIndex)}
- starting lag: ${code(evidence.startingLag)}
- checkpoint state digest: ${code(evidence.stateDigest)}
- checkpoint state bytes: ${code(evidence.stateBytes)}
- collector quiescent: ${code(checks.collectorQuiescentAtCheckpoint)}
- one pending successor scan: ${code(checks.onePendingSuccessorScan)}
- no in-flight work: ${code(checks.noInflightWork)}
- revision-3 quota state included: ${code(checks.revision3QuotaStateIncluded)}
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
  process.stdout.write(`## R5 Supabase active checkpoint

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- checkpoint verifier: ${code('failed')}
- checkpoint ID: ${code(evidence.checkpointId)}
- reason: ${code(evidence.error)}
- active recovery started: ${code(checks.activeRecoveryStarted)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
}
