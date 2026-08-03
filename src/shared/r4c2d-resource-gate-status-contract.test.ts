import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const statusPath = resolve(
  process.cwd(),
  'docs/ops/r4c2d-resource-gate-status-2026-08-03.json',
)
const evidencePath = resolve(
  process.cwd(),
  'docs/ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md',
)
const status = JSON.parse(readFileSync(statusPath, 'utf8'))
const evidence = readFileSync(evidencePath, 'utf8')

describe('R4C2d resource gate status contract', () => {
  it('retains G7 while keeping G8 and profile selection false', () => {
    expect(status.schemaVersion).toBe(1)
    expect(status.phase).toBe('R4C2d')
    expect(status.profileId).toBe('supabase-devnet')
    expect(status.network).toBe('devnet')
    expect(status.gates.G7.status).toBe('qualified')
    expect(status.gates.G7.steady.passed).toBe(true)
    expect(status.gates.G7.catchUp.passed).toBe(true)
    expect(status.gates.G8.status).toBe('incomplete')
    expect(status.gates.G8.qualified).toBe(false)
    expect(status.gates.G8.profileSelected).toBe(false)
  })

  it('keeps measured resource values below their project halt thresholds', () => {
    const resources = status.gates.G8.resources
    expect(resources.databaseStorage.valueBytes).toBeLessThan(
      resources.databaseStorage.haltBytes,
    )
    expect(resources.databaseConnections.value).toBeLessThan(
      resources.databaseConnections.halt,
    )
    expect(resources.edgeWall.maximumMilliseconds).toBeLessThan(
      resources.edgeWall.haltMilliseconds,
    )
    expect(resources.functionInvocations.projected31Days).toBeLessThan(
      resources.functionInvocations.halt31Days,
    )
    expect(resources.bundleSize.maximumBytes).toBeLessThan(
      resources.bundleSize.haltBytes,
    )
    expect(resources.edgeCpu.maximumMilliseconds).toBeLessThan(
      resources.edgeCpu.runtimeHardMilliseconds,
    )
  })

  it('rejects all-zero memory counters as unavailable', () => {
    const memory = status.gates.G8.resources.edgeMemory
    expect(memory.coverage).toBe('unavailable')
    expect(memory.exactMaximumAvailable).toBe(false)
    expect(memory.inProcessSamples).toBe(36)
    expect(memory.allInProcessCountersZero).toBe(true)
    expect(memory.zeroCountersAcceptedAsZeroUsage).toBe(false)
    expect(memory.highWaterQualified).toBe(false)
    expect(memory.passed).toBe(false)
  })

  it('does not substitute Free plan identity for egress or overage evidence', () => {
    const resources = status.gates.G8.resources
    expect(resources.providerPlan.plan).toBe('free')
    expect(resources.providerPlan.exactProjectOrganizationBinding).toBe(true)
    expect(resources.providerPlan.passed).toBe(true)
    expect(resources.uncachedEgress.coverage).toBe('unavailable')
    expect(resources.uncachedEgress.passed).toBe(false)
    expect(resources.cachedEgress.coverage).toBe('unavailable')
    expect(resources.cachedEgress.passed).toBe(false)
    expect(resources.usageBillingFlag.coverage).toBe('unavailable')
    expect(resources.usageBillingFlag.passed).toBe(false)
    expect(resources.automaticOverageApiState.coverage).toBe('unavailable')
    expect(resources.automaticOverageApiState.passed).toBe(false)
    expect(resources.billingAndOverage.qualified).toBe(false)
  })

  it('retains the zero-memory interpretation as explicitly invalid', () => {
    expect(status.invalidatedInterpretations).toHaveLength(1)
    expect(status.invalidatedInterpretations[0].workflowRunId).toBe(30785890154)
    expect(status.invalidatedInterpretations[0].valid).toBe(false)
    expect(status.invalidatedInterpretations[0].replacement).toContain('unavailable')
    expect(evidence).toContain('do not prove zero memory consumption')
    expect(evidence).toContain('memory high-water qualified: `false`')
  })

  it('continues to prohibit later phases and public cutover', () => {
    expect(status.restrictions.publicReaderCutover).toBe(false)
    expect(status.restrictions.r5Recovery).toBe(false)
    expect(status.restrictions.mainnet).toBe(false)
    expect(status.restrictions.stabilization).toBe(false)
    expect(status.restrictions.soak).toBe(false)
  })
})
