import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateDeploymentProfileQualification } from './deployment-profile-qualification'

const statusPath = resolve(
  process.cwd(),
  'docs/ops/r4c2d-resource-gate-status-2026-08-03.json',
)
const evidencePath = resolve(
  process.cwd(),
  'docs/ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md',
)
const decisionPath = resolve(
  process.cwd(),
  'docs/ops/r4c2d-supabase-r4b-decision-2026-08-03.json',
)
const status = JSON.parse(readFileSync(statusPath, 'utf8'))
const evidence = readFileSync(evidencePath, 'utf8')
const decision = JSON.parse(readFileSync(decisionPath, 'utf8'))

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

  it('rejects zero RSS and partial counters as total-memory evidence', () => {
    const memory = status.gates.G8.resources.edgeMemory
    expect(memory.coverage).toBe('unavailable')
    expect(memory.exactMaximumAvailable).toBe(false)
    expect(memory.inProcessSamples).toBe(36)
    expect(memory.allRssCountersZero).toBe(true)
    expect(memory.partialHeapCountersAvailable).toBe(true)
    expect(memory.totalMemoryCounterAvailable).toBe(false)
    expect(memory.partialCountersAcceptedAsTotalMemory).toBe(false)
    expect(memory.zeroRssAcceptedAsZeroUsage).toBe(false)
    expect(memory.highWaterQualified).toBe(false)
    expect(memory.passed).toBe(false)
  })

  it('does not substitute Free plan identity for provider egress counters', () => {
    const resources = status.gates.G8.resources
    expect(resources.providerPlan.plan).toBe('free')
    expect(resources.providerPlan.exactProjectOrganizationBinding).toBe(true)
    expect(resources.providerPlan.passed).toBe(true)
    expect(resources.uncachedEgress.coverage).toBe('unavailable')
    expect(resources.uncachedEgress.passed).toBe(false)
    expect(resources.cachedEgress.coverage).toBe('unavailable')
    expect(resources.cachedEgress.passed).toBe(false)
  })

  it('retains both invalid memory interpretations explicitly', () => {
    expect(status.invalidatedInterpretations).toHaveLength(2)
    expect(status.invalidatedInterpretations[0].workflowRunId).toBe(30785890154)
    expect(status.invalidatedInterpretations[0].valid).toBe(false)
    expect(status.invalidatedInterpretations[0].replacement).toContain('RSS')
    expect(status.invalidatedInterpretations[1].workflowRunId).toBe(30786950713)
    expect(status.invalidatedInterpretations[1].valid).toBe(false)
    expect(status.invalidatedInterpretations[1].replacement).toContain('partial counters')
    expect(evidence).toContain('does not prove zero memory consumption')
    expect(evidence).toContain('partial heap or external counters cannot substitute')
    expect(evidence).toContain('memory high-water qualified: `false`')
  })

  it('evaluates the current profile as conditional with only G8 and G9 unresolved', async () => {
    const evaluated = await evaluateDeploymentProfileQualification({
      schemaVersion: decision.schemaVersion,
      evaluatedAt: decision.evaluatedAt,
      profile: decision.profile,
      profileIdentityDigest: decision.profileIdentityDigest,
      gateEvidence: decision.evidence,
      scorecard: null,
    })

    expect(evaluated).toEqual(decision)
    expect(evaluated.classification).toBe('conditional_candidate')
    expect(evaluated.selection).toBe('not_selected')
    expect(evaluated.eligibleForScoring).toBe(false)
    expect(evaluated.gateSummary).toEqual({ passed: 8, failed: 0, unresolved: 2 })
    expect(evaluated.failedGates).toEqual([])
    expect(evaluated.unresolvedGates).toEqual(['G8', 'G9'])
    expect(evaluated.scoreSummary).toBeNull()
    expect(evaluated.decisionDigest).toBe(
      '407f37226dc47663c7f980a8a1b3c04ed09a03a97add950f1d061db61ba5b897',
    )
  })

  it('continues to prohibit later phases and public cutover', () => {
    expect(status.restrictions.publicReaderCutover).toBe(false)
    expect(status.restrictions.r5Recovery).toBe(false)
    expect(status.restrictions.mainnet).toBe(false)
    expect(status.restrictions.stabilization).toBe(false)
    expect(status.restrictions.soak).toBe(false)
  })
})
