import { readFileSync } from 'node:fs'

const runStatus = process.env.RUN_STATUS ?? 'unknown'
const runId = process.env.RUN_ID ?? 'unknown'
const runUrl = process.env.RUN_URL ?? 'unknown'
const headSha = process.env.HEAD_SHA ?? 'unknown'
const directory = 'supabase-remote-probe-evidence'

function read(name) {
  try {
    return JSON.parse(readFileSync(`${directory}/${name}`, 'utf8'))
  } catch {
    return null
  }
}

const success = read('verified-revision3-accounting.json')
const failure = read('failed-revision3-accounting-verification.json')
const lines = [
  '',
  '## R4C3 revision-3 application-owned resource accounting',
  '',
  `- run: [${runId}](${runUrl})`,
  `- commit: \`${headSha}\``,
  `- job status: \`${runStatus}\``,
]

if (success) {
  const summaries = Array.isArray(success.accountingSummaries)
    ? success.accountingSummaries
    : []
  const memoryBounds = summaries.map((entry) => entry?.conservativeMemoryUpperBoundBytes)
  const tickEgressBounds = summaries.map(
    (entry) => entry?.conservativeTickEgressUpperBoundBytes,
  )
  const monthlyEgressBounds = summaries.map(
    (entry) => entry?.conservativeEgress31dUpperBoundBytes,
  )
  lines.push(
    '- revision-3 accounting verifier: `success`',
    `- verified at: \`${String(success.verifiedAt ?? 'unknown')}\``,
    `- profile ID: \`${String(success.profileId ?? 'unknown')}\``,
    `- profile revision: \`${String(success.profileRevision ?? 'unknown')}\``,
    `- profile identity digest: \`${String(success.profileIdentityDigest ?? 'unknown')}\``,
    `- guarded session: \`${String(success.sessionId ?? 'unknown')}\``,
    `- completed ticks: \`${String(success.completedTicks ?? 'unknown')}\``,
    `- committed ledgers: \`${String(success.committedLedgers ?? 'unknown')}\``,
    `- minute rates: \`${JSON.stringify(success.minuteRates ?? [])}\``,
    `- accounting attempts: \`${String(success.accountingAttempts ?? 'unknown')}\``,
    `- unsafe accounting attempts: \`${String(success.unsafeAccountingAttempts ?? 'unknown')}\``,
    `- conservative memory bounds: \`${JSON.stringify(memoryBounds)}\``,
    `- conservative tick egress bounds: \`${JSON.stringify(tickEgressBounds)}\``,
    `- conservative 31d egress bounds: \`${JSON.stringify(monthlyEgressBounds)}\``,
    `- injected guard kinds: \`${JSON.stringify(success.injectedGuardKinds ?? [])}\``,
    `- accounting recorded before completion: \`${String(success.checks?.accountingRecordedBeforeCompletion ?? 'unknown')}\``,
    `- all bounds below project halts: \`${String(success.checks?.allConservativeBoundsBelowProjectHalts ?? 'unknown')}\``,
    `- all seven injected failures rejected: \`${String(success.checks?.allSevenInjectedPrecommitFailuresRejected ?? 'unknown')}\``,
    `- injected state mutation: \`${String(!(success.checks?.noInjectedStateMutation ?? false))}\``,
    `- active profile read only: \`${String(success.checks?.activeProfileReadOnly ?? 'unknown')}\``,
    `- provider peak memory claimed: \`${String(!(success.checks?.unavailableProviderMemoryNotClaimed ?? false))}\``,
    `- provider egress claimed: \`${String(!(success.checks?.unavailableProviderEgressNotClaimed ?? false))}\``,
    `- G8 qualified: \`${String(success.checks?.g8Qualified ?? 'unknown')}\``,
    `- profile selected: \`${String(success.checks?.profileSelected ?? 'unknown')}\``,
    `- R5 authorized: \`${String(success.checks?.r5Authorized ?? 'unknown')}\``,
  )
} else if (failure) {
  lines.push(
    '- revision-3 accounting verifier: `failed`',
    `- profile ID: \`${String(failure.profileId ?? 'unknown')}\``,
    `- profile revision: \`${String(failure.profileRevision ?? 'unknown')}\``,
    `- profile identity digest: \`${String(failure.profileIdentityDigest ?? 'unknown')}\``,
    `- session: \`${String(failure.sessionId ?? 'unknown')}\``,
    `- failed at: \`${String(failure.failedAt ?? 'unknown')}\``,
    `- reason: \`${String(failure.error ?? 'unknown').slice(0, 1_000)}\``,
    `- G8 qualified: \`${String(failure.checks?.g8Qualified ?? false)}\``,
    `- profile selected: \`${String(failure.checks?.profileSelected ?? false)}\``,
    `- R5 authorized: \`${String(failure.checks?.r5Authorized ?? false)}\``,
  )
} else {
  lines.push('- revision-3 accounting verifier: `not reached or no sanitized evidence produced`')
}

process.stdout.write(`${lines.join('\n')}\n`)
