import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const runtime = read('scripts/record-supabase-runtime-resource-log-snapshot.mjs')
const external = read('scripts/record-supabase-external-resource-snapshot.mjs')
const publisher = read('scripts/publish-supabase-resource-run-locator.mjs')

describe('Supabase function combined statistics evidence contract', () => {
  it('queries every active function through the official one-day statistics endpoint', () => {
    for (const required of [
      "const interval = '1day'",
      "managementRequest('/functions')",
      "managementRequest('/analytics/endpoints/functions.combined-stats'",
      'function_id: fn.id',
      'interval,',
      'mapWithConcurrency(functions, 4',
      'exactActiveFunctionCoverage: functionStats.length === functions.length',
      'officialCombinedStatsEndpoint: true',
    ]) expect(runtime).toContain(required)
    expect(runtime).not.toContain('/analytics/endpoints/logs.all')
    expect(runtime).not.toContain('event_message')
  })

  it('derives invocation counts from the same classified fields as Supabase Studio', () => {
    for (const required of [
      'row.success_count ?? 0',
      'row.redirect_count ?? 0',
      'row.client_err_count ?? 0',
      'row.server_err_count ?? 0',
      'const statusInvocationCount = success + redirect + clientError + serverError',
      'row.requests_count ?? statusInvocationCount',
      'requestsCount < statusInvocationCount',
      'invocationCount24h',
      'requestsCount24h',
      'requestCountCoversClassifiedInvocations: requestsCount24h >= invocationCount24h',
    ]) expect(runtime).toContain(required)
  })

  it('retains aggregate CPU, memory, and execution statistics without raw analytics rows', () => {
    for (const required of [
      'row.max_cpu_time_used ?? 0',
      'row.avg_cpu_time_used ?? 0',
      'row.avg_memory_used ?? 0',
      'row.avg_heap_memory_used ?? 0',
      'row.avg_external_memory_used ?? 0',
      'row.max_execution_time ?? 0',
      'function percentile(sortedValues, fraction)',
      'p50: percentile(sorted, 0.5)',
      'p95: percentile(sorted, 0.95)',
      'maximum: sorted.at(-1)',
      'maxCpuMilliseconds: maxCpu',
      'averageMemoryMegabytes: averageMemory',
      'rawAnalyticsRowsRetained: false',
      'functionIdsRetained: false',
    ]) expect(runtime).toContain(required)
  })

  it('fails closed before CPU and average-memory hard limits without overstating exact memory maximum', () => {
    for (const required of [
      'const cpuHardMilliseconds = 2_000',
      'const cpuHaltMilliseconds = 1_600',
      'const memoryHardMegabytes = 256',
      'const memoryHaltMegabytes = 200',
      'cpuBelowHaltThreshold: maxCpu.maximum < cpuHaltMilliseconds',
      'averageMemoryBelowHaltThreshold: averageMemory.maximum < memoryHaltMegabytes',
      'exactMemoryMaximumCovered: false',
      'function combined statistics crossed a resource halt boundary',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(runtime).toContain(required)
  })

  it('feeds the same invocation evidence into the database resource snapshot', () => {
    for (const required of [
      "await import('./record-supabase-runtime-resource-log-snapshot.mjs')",
      'runtime-resource-log-snapshot.json',
      "value.purpose !== 'r4c2d-function-combined-stats-snapshot'",
      "value.interval !== '1day'",
      'value.checks?.officialCombinedStatsEndpoint !== true',
      'const invocationCount24h = runtime.invocationCount24h',
      "invocationSource: 'functions.combined-stats'",
      'officialCombinedStatsInvocationSource: true',
      'logsBackendNotRequired: true',
    ]) expect(external).toContain(required)
  })

  it('publishes only aggregate combined-statistics evidence', () => {
    for (const required of [
      'runtime-resource-log-snapshot.json',
      'failed-runtime-resource-log-snapshot.json',
      'runtime CPU and memory snapshot',
      'CPU ms p50/p95/max',
    ]) expect(publisher).toContain(required)
  })
})