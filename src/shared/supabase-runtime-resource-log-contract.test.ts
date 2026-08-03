import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const runtime = read('scripts/record-supabase-runtime-resource-log-snapshot.mjs')
const external = read('scripts/record-supabase-external-resource-snapshot.mjs')
const publisher = read('scripts/publish-supabase-resource-run-locator.mjs')

describe('Supabase runtime CPU and memory evidence contract', () => {
  it('queries only function shutdown logs in a bounded 24-hour window', () => {
    for (const required of [
      "WHERE source_name = 'function_logs'",
      "positionCaseInsensitive(event_message, 'Shutdown') > 0",
      'ORDER BY timestamp DESC',
      'LIMIT 1000',
      'iso_timestamp_start: windowStart',
      'iso_timestamp_end: observedAt',
      'windowHours: 24',
    ]) expect(runtime).toContain(required)
  })

  it('extracts runtime-emitted CPU and memory values without retaining raw identities', () => {
    for (const required of [
      'function parseJsonCandidate(value)',
      'function findShutdown(value, seen = new Set())',
      'shutdown.cpu_time_used ?? shutdown.cpuTimeUsed',
      'shutdown.memory_used ?? shutdown.memoryUsed',
      'memory.total ?? memory.total_bytes ?? memory.totalBytes',
      'memory.heap ?? memory.heap_bytes ?? memory.heapBytes ?? 0',
      'memory.external ?? memory.external_bytes ?? memory.externalBytes ?? 0',
      'noRawEventMessagesRetained: true',
      'noExecutionIdsRetained: true',
    ]) expect(runtime).toContain(required)
    expect(runtime).not.toContain('execution_id:')
    expect(runtime).not.toContain('event_message:')
  })

  it('retains p50, p95, maximum and exact shutdown reasons', () => {
    for (const required of [
      'function percentile(sortedValues, fraction)',
      'p50: percentile(sorted, 0.5)',
      'p95: percentile(sorted, 0.95)',
      'maximum: sorted.at(-1)',
      'const reasons = Object.fromEntries(',
      'cpuMilliseconds: cpu',
      'memoryTotalBytes: memoryTotal',
      'memoryHeapBytes: memoryHeap',
      'memoryExternalBytes: memoryExternal',
      "const terminalResourceReasons = ['CPUTime', 'Memory', 'WallClockTime']",
    ]) expect(runtime).toContain(required)
  })

  it('fails closed before the published CPU and memory hard limits', () => {
    for (const required of [
      'const cpuHardMilliseconds = 2_000',
      'const cpuHaltMilliseconds = 1_600',
      'const memoryHardBytes = 256 * 1024 * 1024',
      'const memoryHaltBytes = 200 * 1024 * 1024',
      'noTerminalResourceShutdowns: terminalResourceShutdowns === 0',
      'cpuBelowHaltThreshold: cpu.maximum < cpuHaltMilliseconds',
      'memoryBelowHaltThreshold: memoryTotal.maximum < memoryHaltBytes',
      "throw new Error(`runtime resource evidence crossed a halt boundary:",
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(runtime).toContain(required)
  })

  it('uses the same bounded transient Management API retry', () => {
    for (const required of [
      "const retryableLogErrorPrefix = 'Backend error! Retry your query'",
      'const retryDelaysMilliseconds = [0, 2_000, 5_000, 10_000]',
      'async function queryLogsWithRetry(searchParams)',
      'if (!isRetryable(last)) return { raw: last, attempts: index + 1 }',
      'attempts: retryDelaysMilliseconds.length',
      'boundedTransientLogRetry: true',
    ]) expect(runtime).toContain(required)
  })

  it('is chained after the external invocation and bundle snapshot', () => {
    expect(external).toContain(
      "await import('./record-supabase-runtime-resource-log-snapshot.mjs')",
    )
  })

  it('publishes only aggregate CPU and memory evidence', () => {
    for (const required of [
      'runtime-resource-log-snapshot.json',
      'failed-runtime-resource-log-snapshot.json',
      'runtime CPU and memory snapshot',
      'parsed ShutdownEvent count',
      'shutdown reasons',
      'CPU ms p50/p95/max',
      'total memory bytes p50/p95/max',
      'raw runtime messages retained',
      'execution IDs retained',
    ]) expect(publisher).toContain(required)
  })
})