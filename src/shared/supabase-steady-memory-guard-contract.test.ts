import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read('supabase/migrations/20260803041000_xrpl_steady_memory_guard.sql')
const tick = read('supabase/functions/xrpl-steady-batch-tick/index.ts')
const qualification = read('supabase/functions/xrpl-steady-throughput-qualification/index.ts')
const verifier = read('scripts/verify-supabase-steady-throughput.mjs')
const publisher = read('scripts/publish-supabase-steady-run-locator.mjs')

describe('Supabase steady Edge memory guard contract', () => {
  it('stores bounded samples and high-water evidence on isolated steady ticks', () => {
    for (const required of [
      'memory_samples jsonb',
      'memory_high_water_bytes bigint',
      'memory_sample_count integer',
      'memory_sample_count between 6 and 64',
      'create or replace function public.xrpl_record_network_steady_memory',
      "v_tick.status <> 'leased'",
      "v_session.status <> 'running'",
      'v_session.lease_expires_at <= p_recorded_at',
      'jsonb_array_length(p_memory_samples) <> p_memory_sample_count',
      'p_memory_sample_count > 64',
      'steady memory phase duplicated',
      'v_calculated_high_water <> p_memory_high_water_bytes',
      'steady memory halt threshold reached',
    ]) expect(migration).toContain(required)
  })

  it('requires all six lifecycle phases and a halt below the hard runtime limit', () => {
    for (const required of [
      "'request_start'",
      "'after_claim'",
      "'after_head'",
      "'after_fetch'",
      "'after_normalize'",
      "'before_commit'",
      'v_memory_halt_bytes constant bigint := 209715200',
      'v_memory_hard_bytes constant bigint := 268435456',
      "'sixCompletedTicksMeasured'",
      "'highWaterBelowHalt'",
      "'haltBelowHard'",
      "'profileSelected', false",
      "'g8Qualified', false",
    ]) expect(migration).toContain(required)
  })

  it('samples the exact steady executor and fails before atomic completion', () => {
    for (const required of [
      'const MEMORY_HALT_BYTES = 200 * 1024 * 1024',
      'const usage = Deno.memoryUsage()',
      "sampleMemory('request_start')",
      "sampleMemory('after_claim')",
      "sampleMemory('after_head')",
      "sampleMemory('after_fetch')",
      "sampleMemory('after_normalize')",
      "sampleMemory('before_commit')",
      'const memoryHighWaterBytes = memoryHighWater(memorySamples)',
      'if (memoryHighWaterBytes >= MEMORY_HALT_BYTES)',
      "'xrpl_record_network_steady_memory'",
      "'xrpl_complete_network_steady_tick'",
    ]) expect(tick).toContain(required)
    expect(tick.indexOf("'xrpl_record_network_steady_memory'")).toBeLessThan(
      tick.indexOf("'xrpl_complete_network_steady_tick'"),
    )
  })

  it('validates RSS, heap, and external-memory sample parity', () => {
    for (const required of [
      'rssBytes: usage.rss',
      'heapTotalBytes: usage.heapTotal',
      'heapUsedBytes: usage.heapUsed',
      'externalBytes: usage.external',
      'sample.heapUsedBytes > sample.heapTotalBytes',
      'return Math.max(...samples.map((sample) => sample.rssBytes))',
      "or (v_sample.value->>'heapUsedBytes')::bigint > (v_sample.value->>'heapTotalBytes')::bigint",
    ]) expect(tick + migration).toContain(required)
  })

  it('exposes memory with the same token-gated qualification read', () => {
    for (const required of [
      "rpc<JsonObject>('xrpl_read_network_steady_session'",
      "rpc<JsonObject>('xrpl_read_network_steady_memory'",
      'const [session, memory] = await Promise.all([',
      'session,',
      'memory,',
    ]) expect(qualification).toContain(required)
  })

  it('recalculates all six tick high waters from sanitized samples', () => {
    for (const required of [
      'const memoryHaltBytes = 209715200',
      'const memoryHardBytes = 268435456',
      'function verifyMemory(raw, completedTicks)',
      "memory.purpose !== 'r4c2d-steady-memory-guard'",
      'memory.measuredCompletedTicks !== 6',
      'sampleCount < 6 || sampleCount > 64',
      'calculatedHighWater = Math.max(calculatedHighWater, rss)',
      'calculatedHighWater !== recordedHighWater',
      'recordedHighWater >= memoryHaltBytes',
      'sessionHighWater !== memory.memoryHighWaterBytes',
      'sixCompletedTicksMemoryMeasured: true',
      'requiredMemoryPhasesMeasured: true',
      'memoryHighWaterRecalculated: true',
      'memoryRecordedBeforeCommit: true',
      'memoryFailClosedBelowHardLimit: true',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(verifier).toContain(required)
  })

  it('publishes unavailable memory counters without fake headroom', () => {
    for (const required of [
      'steady memory lifecycle samples recorded',
      'steady memory runtime counters available',
      'steady memory counter reason',
      'all runtime memory counters zero',
      'zero counters interpreted as zero usage',
      'steady memory high water qualified',
      'steady memory min/p50/p95/max bytes',
      'steady memory halt/hard bytes',
      'steady memory headroom bytes',
      "'unavailable'",
      'memory recorded before commit',
      'memory coverage not overstated',
      'memory fail-closed below hard limit',
    ]) expect(publisher).toContain(required)
  })
})