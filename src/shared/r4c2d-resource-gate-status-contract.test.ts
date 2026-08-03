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
const outcomePath = resolve(
  process.cwd(),
  'docs/ops/r4e-deployment-profile-outcome-2026-08-03.json',
)
const status = JSON.parse(readFileSync(statusPath, 'utf8'))
const evidence = readFileSync(evidencePath, 'utf8')
const decision = JSON.parse(readFileSync(decisionPath, 'utf8'))
const outcome = JSON.parse(readFileSync(outcomePath, 'utf8'))

describe('R4C2d resource gate status contract', () => {
  it('retains G7 and G9 while recording the final G8 failure', () => {
    expect(status.schemaVersion).toBe(1)
    expect(status.phase).toBe('R4C2d')
    expect(status.profileId).toBe('supabase-devnet')
    expect(status.network).toBe('devnet')
    expect(status.controllingMainCommit).toBe(
      'db82291a7df3e8d4dfa458891e0a714f7d8d346b',
    )
    expect(status.gates.G7.status).toBe('qualified')
    expect(status.gates.G7.steady.passed).toBe(true)
    expect(status.gates.G7.catchUp.passed).toBe(true)
    expect(status.gates.G8.status).toBe('failed')
    expect(status.gates.G8.qualified).toBe(false)
    expect(status.gates.G8.profileSelected).toBe(false)
    expect(status.gates.G8.disposition).toEqual({
      workflowRunId: 30800402654,
      sourceCommit: 'db82291a7df3e8d4dfa458891e0a714f7d8d346b',
      result: 'reject_profile',
      failureReasons: [
        'provider_exact_peak_memory_unavailable',
        'provider_egress_bytes_unavailable',
        'runtime_total_memory_counter_unavailable',
        'memory_headroom_not_qualified',
      ],
      evidencePublishedToIssue: 1109,
    })
    expect(status.gates.G9.status).toBe('qualified')
    expect(status.gates.G9.workflowRunId).toBe(30789994825)
    expect(status.gates.G9.profileRevision).toBe(2)
    expect(status.gates.G9.passed).toBe(true)
    expect(status.gates.G9.profileSelected).toBe(false)
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

  it('rejects unavailable memory and egress counters instead of substituting weaker signals', () => {
    const resources = status.gates.G8.resources
    const memory = resources.edgeMemory
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
    expect(resources.uncachedEgress.coverage).toBe('unavailable')
    expect(resources.uncachedEgress.passed).toBe(false)
    expect(resources.cachedEgress.coverage).toBe('unavailable')
    expect(resources.cachedEgress.passed).toBe(false)
    expect(resources.providerPlan.plan).toBe('free')
    expect(resources.providerPlan.passed).toBe(true)
  })

  it('retains every invalidated memory interpretation explicitly', () => {
    expect(status.invalidatedInterpretations).toHaveLength(3)
    expect(status.invalidatedInterpretations[0].workflowRunId).toBe(30785890154)
    expect(status.invalidatedInterpretations[0].valid).toBe(false)
    expect(status.invalidatedInterpretations[1].workflowRunId).toBe(30786950713)
    expect(status.invalidatedInterpretations[1].valid).toBe(false)
    expect(status.invalidatedInterpretations[2].workflowRunId).toBe(30792758520)
    expect(status.invalidatedInterpretations[2].valid).toBe(false)
    expect(status.invalidatedInterpretations[2].replacement).toContain(
      'function-scoped',
    )
    expect(evidence).toContain('does not prove zero memory consumption')
    expect(evidence).toContain('partial heap or external counters cannot substitute')
  })

  it('retains the complete revision-2 operator-independence proof', () => {
    const operator = status.gates.G9
    expect(operator.profileIdentityDigest).toBe(
      'c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998',
    )
    expect(operator.checks).toEqual({
      deployScripted: true,
      rollbackScriptedAndRemotelyProved: true,
      checkpointScriptedAndRemotelyProved: true,
      exportScriptedAndRemotelyProved: true,
      restoreScriptedAndRemotelyProved: true,
      repeatableRestoreConvergenceProved: true,
      evidenceScripted: true,
      haltScriptedAndRemotelyProved: true,
      credentialRotationScripted: true,
      noRoutineDashboardOrTerminalOperation: true,
      exactProfileRevisionBound: true,
      activeProfileReadOnly: true,
    })
  })

  it('re-evaluates revision 2 as rejected with G8 failed', async () => {
    const evaluated = await evaluateDeploymentProfileQualification({
      schemaVersion: decision.schemaVersion,
      evaluatedAt: decision.evaluatedAt,
      profile: decision.profile,
      profileIdentityDigest: decision.profileIdentityDigest,
      gateEvidence: decision.evidence,
      scorecard: null,
    })

    expect(evaluated).toEqual(decision)
    expect(evaluated.classification).toBe('rejected')
    expect(evaluated.selection).toBe('not_selected')
    expect(evaluated.eligibleForScoring).toBe(false)
    expect(evaluated.gateSummary).toEqual({ passed: 9, failed: 1, unresolved: 0 })
    expect(evaluated.failedGates).toEqual(['G8'])
    expect(evaluated.unresolvedGates).toEqual([])
    expect(evaluated.evidence.find((entry) => entry.gateId === 'G8')?.status).toBe(
      'fail',
    )
    expect(evaluated.scoreSummary).toBeNull()
    expect(evaluated.decisionDigest).toBe(
      'd1577a896e3f4e512a362586ae30990aceb5142f0783feb529626fa6f035e111',
    )
  })

  it('records R4E no-profile-qualified and advances only to revision-3 qualification', () => {
    expect(outcome.schemaVersion).toBe(1)
    expect(outcome.phase).toBe('R4E')
    expect(outcome.outcome).toBe('no_profile_qualified')
    expect(outcome.selectedProfile).toBeNull()
    expect(outcome.controllingDecision.classification).toBe('rejected')
    expect(outcome.controllingDecision.failedGates).toEqual(['G8'])
    expect(outcome.controllingDecision.decisionDigest).toBe(
      'd1577a896e3f4e512a362586ae30990aceb5142f0783feb529626fa6f035e111',
    )
    expect(outcome.nextPhase.phase).toBe('R4C3')
    expect(outcome.nextPhase.r5Authorized).toBe(false)
    expect(outcome.outcomeDigest).toBe(
      'c04d75c38c103b9549351ca92a8dab113e754e7e2ed720b93a17f58ff138bacb',
    )
  })

  it('continues to prohibit later phases and public cutover', () => {
    expect(status.restrictions.publicReaderCutover).toBe(false)
    expect(status.restrictions.r5Recovery).toBe(false)
    expect(status.restrictions.mainnet).toBe(false)
    expect(status.restrictions.stabilization).toBe(false)
    expect(status.restrictions.soak).toBe(false)
    expect(outcome.restrictions).toEqual(status.restrictions)
  })
})
