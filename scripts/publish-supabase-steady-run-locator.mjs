import { existsSync, readFileSync } from 'node:fs'

const directory = 'supabase-remote-probe-evidence'

function read(name) {
  const path = `${directory}/${name}`
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

const lines = []
for (const [label, name] of [
  ['steady batch tick bundle', 'steady-batch-tick-bundle.json'],
  ['steady qualification bundle', 'steady-throughput-qualification-bundle.json'],
]) {
  const value = read(name)
  if (!value) continue
  lines.push(
    `- ${label} bytes: \`${String(value.bytes ?? 'unknown')}\``,
    `- ${label} sha256: \`${String(value.sha256 ?? 'unknown')}\``,
    `- ${label} relative imports: \`${String(value.relativeImports ?? 'unknown')}\``,
    `- ${label} Cloudflare imports: \`${String(value.cloudflareImports ?? 'unknown')}\``,
  )
}

const success = read('verified-steady-throughput.json')
const failure = read('failed-steady-throughput-verification.json')
if (success) {
  const ticks = Array.isArray(success.session?.ticks)
    ? success.session.ticks.filter((tick) => tick.status === 'completed')
    : []
  lines.push(
    '- steady throughput verifier: `success`',
    `- steady verified at: \`${String(success.verifiedAt ?? 'unknown')}\``,
    `- steady session: \`${String(success.sessionId ?? 'unknown')}\``,
    `- steady completed ticks: \`${String(ticks.length)}\``,
    `- steady minute rates: \`${JSON.stringify(success.minuteRates ?? [])}\``,
    `- steady min/p50/p95/max ledgers per minute: \`${String(success.summary?.minimumCommittedLedgersPerMinute ?? 'unknown')} / ${String(success.summary?.p50CommittedLedgersPerMinute ?? 'unknown')} / ${String(success.summary?.p95CommittedLedgersPerMinute ?? 'unknown')} / ${String(success.summary?.maximumCommittedLedgersPerMinute ?? 'unknown')}\``,
    `- steady observed pass: \`${String(success.summary?.steadyObservedPass ?? 'unknown')}\``,
    `- retained catch-up pass: \`${String(success.summary?.catchUpObservedPass ?? 'unknown')}\``,
    `- G7 qualified: \`${String(success.summary?.g7Qualified ?? 'unknown')}\``,
    `- G8 qualified: \`${String(success.checks?.g8Qualified ?? 'unknown')}\``,
    `- active profile read only: \`${String(success.checks?.activeProfileReadOnly ?? 'unknown')}\``,
  )
} else if (failure) {
  lines.push(
    '- steady throughput verifier: `failed`',
    `- steady failed at: \`${String(failure.failedAt ?? 'unknown')}\``,
    `- steady session: \`${String(failure.sessionId ?? 'unknown')}\``,
    `- steady reason: \`${String(failure.reason ?? 'unknown').slice(0, 800)}\``,
  )
} else {
  lines.push('- steady throughput verifier: `not reached or no sanitized evidence produced`')
}

if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`)
