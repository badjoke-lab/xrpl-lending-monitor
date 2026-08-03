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
const memoryCapability = read('steady-memory-capability.json')
const memoryCapabilityFailure = read('failed-steady-memory-capability.json')
if (success) {
  const ticks = Array.isArray(success.session?.ticks)
    ? success.session.ticks.filter((tick) => tick.status === 'completed')
    : []
  const memoryAvailable = success.checks?.memoryMeasurementAvailable === true
  lines.push(
    '- steady throughput verifier: `success`',
    `- steady verified at: \`${String(success.verifiedAt ?? 'unknown')}\``,
    `- steady session: \`${String(success.sessionId ?? 'unknown')}\``,
    `- steady completed ticks: \`${String(ticks.length)}\``,
    `- steady minute rates: \`${JSON.stringify(success.minuteRates ?? [])}\``,
    `- steady min/p50/p95/max ledgers per minute: \`${String(success.summary?.minimumCommittedLedgersPerMinute ?? 'unknown')} / ${String(success.summary?.p50CommittedLedgersPerMinute ?? 'unknown')} / ${String(success.summary?.p95CommittedLedgersPerMinute ?? 'unknown')} / ${String(success.summary?.maximumCommittedLedgersPerMinute ?? 'unknown')}\``,
    `- steady observed pass: \`${String(success.summary?.steadyObservedPass ?? 'unknown')}\``,
    `- retained catch-up pass: \`${String(success.summary?.catchUpObservedPass ?? 'unknown')}\``,
    `- steady memory lifecycle samples recorded: \`${String(success.totalMemorySamples ?? 'unknown')}\``,
    `- steady memory runtime counters available: \`${String(memoryAvailable)}\``,
    `- steady memory counter reason: \`${String(success.memorySummary?.measurementReason ?? 'none')}\``,
    `- all runtime memory counters zero: \`${String(memoryCapability?.allRuntimeCountersZero ?? 'unknown')}\``,
    `- zero counters interpreted as zero usage: \`${String(!(memoryCapability?.checks?.zeroCountersNotInterpretedAsZeroUsage ?? false))}\``,
    `- steady memory high water qualified: \`${String(success.checks?.memoryQualified ?? false)}\``,
    `- steady memory min/p50/p95/max bytes: \`${memoryAvailable ? `${String(success.memorySummary?.minimumMemoryHighWaterBytes ?? 'unknown')} / ${String(success.memorySummary?.p50MemoryHighWaterBytes ?? 'unknown')} / ${String(success.memorySummary?.p95MemoryHighWaterBytes ?? 'unknown')} / ${String(success.memorySummary?.maximumMemoryHighWaterBytes ?? 'unknown')}` : 'unavailable'}\``,
    `- steady memory halt/hard bytes: \`${String(success.memorySummary?.memoryHaltBytes ?? 'unknown')} / ${String(success.memorySummary?.memoryHardBytes ?? 'unknown')}\``,
    `- steady memory headroom bytes: \`${memoryAvailable ? String(success.memorySummary?.memoryHeadroomBytes ?? 'unknown') : 'unavailable'}\``,
    `- memory recorded before commit: \`${String(success.checks?.memoryRecordedBeforeCommit ?? 'unknown')}\``,
    `- memory coverage not overstated: \`${String(success.checks?.memoryCoverageNotOverstated ?? 'unknown')}\``,
    `- memory fail-closed below hard limit: \`${String(success.checks?.memoryFailClosedBelowHardLimit ?? false)}\``,
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

if (memoryCapabilityFailure) {
  lines.push(
    '- steady memory capability reconciliation: `failed`',
    `- steady memory capability reason: \`${String(memoryCapabilityFailure.reason ?? 'unknown').slice(0, 800)}\``,
  )
}

if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`)