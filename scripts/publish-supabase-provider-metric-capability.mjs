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

const success = read('provider-metric-capability.json')
const failure = read('failed-provider-metric-capability.json')
const disposition = read('g8-resource-disposition.json')
const dispositionFailure = read('failed-g8-resource-disposition.json')
const lines = [
  '',
  '## R4C2d provider metric capability',
  '',
  `- run: [${runId}](${runUrl})`,
  `- commit: \`${headSha}\``,
  `- job status: \`${runStatus}\``,
]

if (success) {
  const status = Object.fromEntries(
    (success.endpoints ?? []).map((entry) => [entry.name, entry.status]),
  )
  lines.push(
    '- provider metric capability probe: `success`',
    `- usage.api-counts status: \`${String(status['usage.api-counts'] ?? 'unknown')}\``,
    `- usage.api-requests-count status: \`${String(status['usage.api-requests-count'] ?? 'unknown')}\``,
    `- functions.combined-stats status: \`${String(status['functions.combined-stats'] ?? 'unknown')}\``,
    `- metrics status: \`${String(status.metrics ?? 'unknown')}\``,
    `- organization usage daily with PAT status: \`${String(status['organization.usage.daily'] ?? 'unknown')}\``,
    `- request counts available: \`${String(success.coverage?.requestCountsAvailable ?? 'unknown')}\``,
    `- function average memory available: \`${String(success.coverage?.averageMemoryAvailable ?? 'unknown')}\``,
    `- generic project process memory available: \`${String(success.coverage?.genericProjectProcessMemoryAvailable ?? 'unknown')}\``,
    `- provider egress bytes available: \`${String(success.coverage?.providerEgressBytesAvailable ?? 'unknown')}\``,
    `- exact peak Edge memory available: \`${String(success.coverage?.exactPeakEdgeMemoryAvailable ?? 'unknown')}\``,
    `- discovered provider egress fields: \`${JSON.stringify(success.discoveredFields?.providerEgress ?? [])}\``,
    `- discovered exact peak Edge memory fields: \`${JSON.stringify(success.discoveredFields?.exactPeakEdgeMemory ?? [])}\``,
    `- discovered generic project process memory fields: \`${JSON.stringify(success.discoveredFields?.genericProjectProcessMemory ?? [])}\``,
    `- generic process metrics accepted as Edge memory: \`${String(!(success.checks?.genericProcessMetricsNotAcceptedAsEdgeMemory ?? false))}\``,
    `- raw response values retained: \`${String(success.checks?.rawResponseValuesRetained ?? 'unknown')}\``,
    `- organization slug retained: \`${String(success.checks?.organizationSlugRetained ?? 'unknown')}\``,
    `- project ref retained: \`${String(success.checks?.projectRefRetained ?? 'unknown')}\``,
    `- function ID retained: \`${String(success.checks?.functionIdRetained ?? 'unknown')}\``,
    `- provider coverage not overstated: \`${String(success.checks?.providerCoverageNotOverstated ?? 'unknown')}\``,
    `- G8 qualified: \`${String(success.checks?.g8Qualified ?? 'unknown')}\``,
    `- profile selected: \`${String(success.checks?.profileSelected ?? 'unknown')}\``,
  )
} else if (failure) {
  lines.push(
    '- provider metric capability probe: `failed`',
    `- failed at: \`${String(failure.failedAt ?? 'unknown')}\``,
    `- reason: \`${String(failure.reason ?? 'unknown').slice(0, 1_000)}\``,
    `- G8 qualified: \`${String(failure.checks?.g8Qualified ?? false)}\``,
    `- profile selected: \`${String(failure.checks?.profileSelected ?? false)}\``,
  )
} else {
  lines.push('- provider metric capability probe: `not reached or no sanitized evidence produced`')
}

lines.push('', '## R4C2d G8 final resource disposition', '')
if (disposition) {
  lines.push(
    '- G8 disposition verifier: `success`',
    `- G8 status: \`${String(disposition.status ?? 'unknown')}\``,
    `- disposition: \`${String(disposition.disposition ?? 'unknown')}\``,
    `- failure reasons: \`${JSON.stringify(disposition.failureReasons ?? [])}\``,
    `- evidence digest: \`${String(disposition.evidenceDigest ?? 'unknown')}\``,
    `- request counts substituted for egress: \`${String(!(disposition.checks?.requestCountsNotSubstitutedForEgressBytes ?? false))}\``,
    `- average memory substituted for peak memory: \`${String(!(disposition.checks?.averageMemoryNotSubstitutedForPeakMemory ?? false))}\``,
    `- partial heap substituted for total memory: \`${String(!(disposition.checks?.partialHeapNotSubstitutedForTotalMemory ?? false))}\``,
    `- zero RSS substituted for zero usage: \`${String(!(disposition.checks?.zeroRssNotSubstitutedForZeroUsage ?? false))}\``,
    `- unavailable hard-gate evidence causes failure: \`${String(disposition.checks?.unavailableHardGateEvidenceCausesFailure ?? 'unknown')}\``,
    `- profile rejected when G8 fails: \`${String(disposition.checks?.profileRejectedWhenG8Fails ?? 'unknown')}\``,
    `- G8 qualified: \`${String(disposition.checks?.g8Qualified ?? 'unknown')}\``,
    `- profile selected: \`${String(disposition.checks?.profileSelected ?? 'unknown')}\``,
  )
} else if (dispositionFailure) {
  lines.push(
    '- G8 disposition verifier: `failed`',
    `- failed at: \`${String(dispositionFailure.failedAt ?? 'unknown')}\``,
    `- reason: \`${String(dispositionFailure.reason ?? 'unknown').slice(0, 1_000)}\``,
    `- G8 qualified: \`${String(dispositionFailure.checks?.g8Qualified ?? false)}\``,
    `- profile selected: \`${String(dispositionFailure.checks?.profileSelected ?? false)}\``,
  )
} else {
  lines.push('- G8 disposition verifier: `not reached or no sanitized evidence produced`')
}

process.stdout.write(`${lines.join('\n')}\n`)