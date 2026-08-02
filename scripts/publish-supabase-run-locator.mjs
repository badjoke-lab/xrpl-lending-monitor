import { existsSync, readFileSync } from 'node:fs'

const directory = 'supabase-remote-probe-evidence'

function read(name) {
  const path = `${directory}/${name}`
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

const lines = [
  '## Supabase deployment verification',
  '',
  `- run: [${process.env.RUN_ID ?? 'unknown'}](${process.env.RUN_URL ?? ''})`,
  `- commit: \`${process.env.HEAD_SHA ?? 'unknown'}\``,
  `- job status: \`${process.env.RUN_STATUS ?? 'unknown'}\``,
]

const bundles = [
  ['collector bundle', 'bundle.json'],
  ['committed reader bundle', 'reader-bundle.json'],
  ['historical loader bundle', 'historical-loader-bundle.json'],
  ['historical reader bundle', 'historical-reader-bundle.json'],
  ['multi-chunk executor bundle', 'multichunk-executor-bundle.json'],
  ['multi-chunk reader bundle', 'multichunk-reader-bundle.json'],
  ['complete-state transfer bundle', 'complete-state-transfer-bundle.json'],
  ['restore continuation bundle', 'restore-continuation-bundle.json'],
  ['remote fault qualification bundle', 'remote-fault-qualification-bundle.json'],
]
for (const [label, name] of bundles) {
  const value = read(name)
  if (!value) continue
  lines.push(
    `- ${label} bytes: \`${String(value.bytes ?? 'unknown')}\``,
    `- ${label} sha256: \`${String(value.sha256 ?? 'unknown')}\``,
    `- ${label} relative imports: \`${String(value.relativeImports ?? 'unknown')}\``,
    `- ${label} Cloudflare imports: \`${String(value.cloudflareImports ?? 'unknown')}\``,
  )
}

const health = read('verified-health.json')
const healthFailure = read('failed-verification.json')
if (health) {
  const runtime = health.health?.runtime ?? {}
  const watermark = health.health?.phaseChain?.watermark ?? {}
  lines.push(
    '- verifier: `success`',
    `- evidence schema: \`${String(health.schemaVersion ?? 'unknown')}\``,
    `- verified at: \`${String(health.verifiedAt ?? 'unknown')}\``,
    `- verifier attempt: \`${String(health.attempt ?? 'unknown')}\``,
    `- completed ticks: \`${String(runtime.tick_count ?? 'unknown')}\``,
    `- consecutive failures: \`${String(runtime.consecutive_failures ?? 'unknown')}\``,
    `- phase watermark ledger: \`${String(watermark.ledger_index ?? 'not available')}\``,
    `- phase watermark work: \`${String(watermark.work_id ?? 'not available')}\``,
  )
} else if (healthFailure) {
  lines.push(
    '- verifier: `failed`',
    `- failed at: \`${String(healthFailure.failedAt ?? 'unknown')}\``,
    `- reason: \`${String(healthFailure.reason ?? 'unknown').slice(0, 500)}\``,
  )
} else {
  lines.push('- verifier: `not reached or no sanitized evidence produced`')
}

function appendVerification({
  successFile,
  failureFile,
  label,
  successLines,
}) {
  const success = read(successFile)
  const failure = read(failureFile)
  if (success) {
    lines.push(`- ${label}: \`success\``)
    for (const line of successLines(success)) lines.push(line)
  } else if (failure) {
    lines.push(
      `- ${label}: \`failed\``,
      `- ${label} failed at: \`${String(failure.failedAt ?? 'unknown')}\``,
      `- ${label} reason: \`${String(failure.reason ?? 'unknown').slice(0, 500)}\``,
    )
  } else {
    lines.push(`- ${label}: \`not reached or no sanitized evidence produced\``)
  }
}

appendVerification({
  successFile: 'verified-reader.json',
  failureFile: 'failed-reader-verification.json',
  label: 'committed reader verifier',
  successLines: (value) => [
    `- reader verified at: \`${String(value.verifiedAt ?? 'unknown')}\``,
    `- reader verifier attempt: \`${String(value.attempt ?? 'unknown')}\``,
    `- reader fence ledger: \`${String(value.fence?.ledgerIndex ?? 'not available')}\``,
    `- reader fence work: \`${String(value.fence?.workId ?? 'not available')}\``,
  ],
})

appendVerification({
  successFile: 'verified-historical-witness.json',
  failureFile: 'failed-historical-witness-verification.json',
  label: 'historical witness verifier',
  successLines: (value) => [
    `- historical verified at: \`${String(value.verifiedAt ?? 'unknown')}\``,
    `- historical records: \`${String(value.fullPagination?.rowCount ?? 'unknown')}\``,
    `- historical page sizes: \`${JSON.stringify(value.fullPagination?.pageSizes ?? [])}\``,
    `- historical class counts: \`${JSON.stringify(value.classCounts ?? {})}\``,
    `- historical relationship rows: \`${String(value.relationship?.rowCount ?? 'unknown')}\``,
    `- historical fence ledger: \`${String(value.fence?.ledgerIndex ?? 'unknown')}\``,
  ],
})

appendVerification({
  successFile: 'verified-multichunk-witness.json',
  failureFile: 'failed-multichunk-witness-verification.json',
  label: 'multi-chunk witness verifier',
  successLines: (value) => [
    `- multi-chunk verified at: \`${String(value.verifiedAt ?? 'unknown')}\``,
    `- multi-chunk work: \`${String(value.workId ?? 'unknown')}\``,
    `- multi-chunk payload rows: \`${JSON.stringify((value.payloadChunks ?? []).map((chunk) => chunk.record_count))}\``,
    `- multi-chunk commit rows: \`${JSON.stringify((value.commitChunks ?? []).map((chunk) => chunk.row_mutation_count))}\``,
    `- multi-chunk reader pages: \`${JSON.stringify(value.fullPagination?.pageSizes ?? [])}\``,
    `- multi-chunk reader rows: \`${String(value.fullPagination?.rowCount ?? 'unknown')}\``,
    `- active watermark isolated: \`${String(value.checks?.activeWatermarkIsolated ?? 'unknown')}\``,
  ],
})

appendVerification({
  successFile: 'verified-complete-state-transfer.json',
  failureFile: 'failed-complete-state-transfer-verification.json',
  label: 'complete-state transfer verifier',
  successLines: (value) => [
    `- complete-state transfer verified at: \`${String(value.verifiedAt ?? 'unknown')}\``,
    `- complete-state export: \`${String(value.exportId ?? 'unknown')}\``,
    `- complete-state target: \`${String(value.targetId ?? 'unknown')}\``,
    `- complete-state digest: \`${String(value.stateDigest ?? 'unknown')}\``,
    `- complete-state canonical bytes: \`${String(value.canonicalTextBytes ?? 'unknown')}\``,
    `- complete-state row counts: \`${JSON.stringify(value.rowCounts ?? {})}\``,
    `- complete-state scheduler statuses: \`${JSON.stringify(value.schedulerStatusCounts ?? {})}\``,
    `- empty-target restore observed: \`${String(value.emptyTargetRestoreObserved ?? 'unknown')}\``,
    `- duplicate restore converged: \`${String(value.duplicateRestoreConverged ?? 'unknown')}\``,
    `- digest tamper rejected: \`${String(value.digestTamperRejected ?? 'unknown')}\``,
    `- active profile isolated: \`${String(value.checks?.activeProfileIsolated ?? 'unknown')}\``,
    `- post-restore continuation proved: \`${String(value.checks?.postRestoreContinuationProved ?? 'unknown')}\``,
  ],
})

appendVerification({
  successFile: 'verified-restore-continuation.json',
  failureFile: 'failed-restore-continuation-verification.json',
  label: 'restore continuation verifier',
  successLines: (value) => [
    `- restore continuation verified at: \`${String(value.verifiedAt ?? 'unknown')}\``,
    `- restore continuation source: \`${String(value.sourceProfileId ?? 'unknown')}\``,
    `- restore continuation target: \`${String(value.targetId ?? 'unknown')}\``,
    `- restore anchor ledger: \`${String(value.anchor?.ledgerIndex ?? 'unknown')}\``,
    `- restored watermark ledger: \`${String(value.continuation?.ledgerIndex ?? 'unknown')}\``,
    `- restored committed rows: \`${String(value.continuation?.rowCount ?? 'unknown')}\``,
    `- restored phase sequence: \`${JSON.stringify((value.phaseSequence ?? []).map((entry) => `${entry.phase}:${entry.status}`))}\``,
    `- duplicate phase replay count: \`${String(value.duplicatePhaseReplayCount ?? 'unknown')}\``,
    `- post-restore continuation proved: \`${String(value.checks?.postRestoreContinuationProved ?? 'unknown')}\``,
  ],
})

appendVerification({
  successFile: 'verified-remote-fault-qualification.json',
  failureFile: 'failed-remote-fault-qualification-verification.json',
  label: 'remote fault qualification verifier',
  successLines: (value) => [
    `- remote fault verified at: \`${String(value.verifiedAt ?? 'unknown')}\``,
    `- remote fault profile: \`${String(value.profileId ?? 'unknown')}\``,
    `- remote fault statuses: \`${JSON.stringify(value.messageStatusCounts ?? {})}\``,
    `- remote fault events: \`${JSON.stringify(value.eventTypes ?? [])}\``,
    `- interruption rollback proved: \`${String(value.checks?.interruptionRollbackProved ?? 'unknown')}\``,
    `- retry and backoff proved: \`${String(value.checks?.retryBackoffProved ?? 'unknown')}\``,
    `- stale lease reclaim proved: \`${String(value.checks?.staleLeaseReclaimProved ?? 'unknown')}\``,
    `- terminal fail-closed halt proved: \`${String(value.checks?.terminalFailClosedHaltProved ?? 'unknown')}\``,
    `- active profile isolated: \`${String(value.checks?.activeProfileIsolated ?? 'unknown')}\``,
  ],
})

process.stdout.write(`${lines.join('\n')}\n`)
