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

const success = read('verified-resource-headroom-guard.json')
const failure = read('failed-resource-headroom-guard-verification.json')
const bundle = read('resource-headroom-guard-bundle.json')
const lines = [
  '',
  '## R4C2d resource headroom guard',
  '',
  `- run: [${runId}](${runUrl})`,
  `- commit: \`${headSha}\``,
  `- job status: \`${runStatus}\``,
]

if (bundle) {
  lines.push(
    `- resource guard bundle bytes: \`${String(bundle.bytes ?? 'unknown')}\``,
    `- resource guard bundle sha256: \`${String(bundle.sha256 ?? 'unknown')}\``,
    `- resource guard bundle relative imports: \`${String(bundle.relativeImports ?? 'unknown')}\``,
    `- resource guard bundle Cloudflare imports: \`${String(bundle.cloudflareImports ?? 'unknown')}\``,
  )
}

if (success) {
  const snapshot = success.liveSnapshot ?? {}
  const measurements = snapshot.measurements ?? {}
  const failures = Array.isArray(snapshot.failures)
    ? snapshot.failures.map((entry) => entry?.kind).filter(Boolean)
    : []
  lines.push(
    '- resource headroom guard verifier: `success`',
    `- resource guard verified at: \`${String(success.verifiedAt ?? 'unknown')}\``,
    `- six fail-closed thresholds proved: \`${String(success.checks?.sixFailClosedThresholdsProved ?? 'unknown')}\``,
    `- pre-reservation halt proved: \`${String(success.checks?.preReservationHaltProved ?? 'unknown')}\``,
    `- active profile read only: \`${String(success.checks?.activeProfileReadOnly ?? 'unknown')}\``,
    `- current guard allowed: \`${String(snapshot.allowed ?? 'unknown')}\``,
    `- current guard failures: \`${JSON.stringify(failures)}\``,
    `- database bytes: \`${String(measurements.databaseBytes ?? 'unknown')}\``,
    `- database connections: \`${String(measurements.connectionCount ?? 'unknown')}\``,
    `- max Edge wall ms 24h: \`${String(measurements.maxEdgeWallMilliseconds24h ?? 'unknown')}\``,
    `- G8 qualified: \`${String(success.checks?.g8Qualified ?? 'unknown')}\``,
    `- profile selected: \`${String(success.checks?.profileSelected ?? 'unknown')}\``,
  )
} else if (failure) {
  lines.push(
    '- resource headroom guard verifier: `failed`',
    `- resource guard failed at: \`${String(failure.failedAt ?? 'unknown')}\``,
    `- resource guard reason: \`${String(failure.reason ?? 'unknown')}\``,
  )
} else {
  lines.push('- resource headroom guard verifier: `not reached or no sanitized evidence produced`')
}

process.stdout.write(`${lines.join('\n')}\n`)