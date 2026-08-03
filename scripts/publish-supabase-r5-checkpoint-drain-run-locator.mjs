import { existsSync, readFileSync } from 'node:fs'

const successPath =
  'supabase-remote-probe-evidence/verified-r5-checkpoint-boundary-drain.json'
const failurePath =
  'supabase-remote-probe-evidence/failed-r5-checkpoint-boundary-drain-verification.json'

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function code(value) {
  return `\`${String(value)}\``
}

if (existsSync(successPath)) {
  const evidence = read(successPath)
  const before = evidence.watermarkBefore ?? {}
  const after = evidence.watermarkAfter ?? {}
  const checks = evidence.checks ?? {}
  process.stdout.write(`## R5 checkpoint boundary drain

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- drain verifier: ${code('success')}
- checkpoint ID: ${code(evidence.checkpointId)}
- skipped: ${code(evidence.skipped)}
- reason: ${code(evidence.reason ?? 'drained_existing_phase_work')}
- drained steps: ${code(evidence.drainedStepCount)}
- drained phases: ${code(JSON.stringify((evidence.drainedPhases ?? []).map((item) => item.phase)))}
- watermark before: ${code(before.ledgerIndex ?? 'unchanged_checkpoint')}
- watermark after: ${code(after.ledgerIndex ?? 'unchanged_checkpoint')}
- no scan executed: ${code(checks.noScanExecuted ?? true)}
- pending scan bound to watermark: ${code(checks.pendingScanBoundToWatermark ?? true)}
- no in-flight work: ${code(checks.noInflightWork ?? true)}
- active recovery started: ${code(checks.activeRecoveryStarted)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
} else if (existsSync(failurePath)) {
  const evidence = read(failurePath)
  const checks = evidence.checks ?? {}
  process.stdout.write(`## R5 checkpoint boundary drain

- run: ${code(evidence.sourceRunId)}
- commit: ${code(evidence.sourceCommit)}
- drain verifier: ${code('failed')}
- checkpoint ID: ${code(evidence.checkpointId)}
- reason: ${code(evidence.error)}
- active recovery started: ${code(checks.activeRecoveryStarted)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(checks.stabilizationAuthorized)}
- soak authorized: ${code(checks.soakAuthorized)}

`)
}
