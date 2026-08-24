import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const script = resolve(process.cwd(), 'scripts/assess-r5-post-terminal-apply-readiness.mjs')
const guard = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'ops/production-sql/20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json',
    ),
    'utf8',
  ),
)
const sourceCommit = 'a'.repeat(40)

function terminalFixture() {
  return {
    schemaVersion: 1,
    purpose: 'xrpl-terminal-certificate-archive-independent-readonly-verify',
    sourceCommit,
    executionCommit: guard.executionCommit,
    atomicBundleSha256: guard.bundleSha256,
    productionDatabaseReadOnly: true,
    productionMutationAuthorized: false,
    r5RearmAuthorized: false,
    mainnetEnabled: false,
    passed: true,
  }
}

function databaseGuardFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    purpose: 'r5-revision4-database-guard-post-apply-readonly-verification',
    sourceCommit,
    databaseBytes: 350_000_000,
    databaseHaltBytes: 400_000_000,
    databaseHeadroomBytes: 50_000_000,
    guardInstalled: true,
    run: {
      runId: 'r5-recovery-selected-revision4-minute2-entry',
      status: 'halted',
      lastError: 'r5_recovery_database_halt',
    },
    batchCounts: { total: 1, leased: 0, halted: 1, committed: 0 },
    scheduler: { count: 1, schedule: '* * * * *', active: true },
    naturalDatabaseHaltObserved: true,
    productionDatabaseReadOnly: true,
    manualClaimInvoked: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    rearmAuthorized: false,
    ...overrides,
  }
}

function capacityQualificationFixture(databaseGuard: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    purpose: 'r5-free-operation-capacity-readonly-qualification',
    sourceCommit,
    productionDatabaseReadOnly: true,
    currentSpecificationIntact: true,
    integrityPreservingReclaimOrRetentionProven: true,
    postReclaimCapacityRemeasured: true,
    growthRemeasured: true,
    sustainedFreeOperationCapacityProblemClosed: true,
    safeForR5Rearm: true,
    databaseBytes: databaseGuard.databaseBytes,
    databaseHaltBytes: 400_000_000,
    databaseHeadroomBytes: databaseGuard.databaseHeadroomBytes,
    r5RearmAuthorized: false,
    mainnetEnabled: false,
  }
}

function runAssessment(
  databaseGuard: Record<string, unknown>,
  databaseGuardExit = 0,
  capacityQualification?: Record<string, unknown>,
) {
  const dir = mkdtempSync(join(tmpdir(), 'r5-post-terminal-readiness-'))
  const terminalPath = join(dir, 'terminal.json')
  const databaseGuardPath = join(dir, 'database-guard.json')
  const capacityPath = join(dir, 'capacity.json')
  const outputPath = join(dir, 'readiness.json')
  writeFileSync(terminalPath, JSON.stringify(terminalFixture()))
  writeFileSync(databaseGuardPath, JSON.stringify(databaseGuard))
  const args = [
    script,
    '--source-commit',
    sourceCommit,
    '--terminal-verify',
    terminalPath,
    '--database-guard',
    databaseGuardPath,
    '--database-guard-exit',
    String(databaseGuardExit),
    '--output',
    outputPath,
  ]
  if (capacityQualification) {
    writeFileSync(capacityPath, JSON.stringify(capacityQualification))
    args.push('--capacity-qualification', capacityPath)
  }
  execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'pipe' })
  return JSON.parse(readFileSync(outputPath, 'utf8'))
}

describe('R5 post-terminal apply rearm readiness', () => {
  it('refuses rearm candidacy on positive headroom alone', () => {
    const databaseGuard = databaseGuardFixture({
      databaseBytes: 395_824_275,
      databaseHeadroomBytes: 4_175_725,
    })
    const evidence = runAssessment(databaseGuard)
    const codes = evidence.blockers.map((entry: { code: string }) => entry.code)
    expect(evidence.candidateForSeparateRearmAuthorization).toBe(false)
    expect(evidence.capacityQualificationRequired).toBe(true)
    expect(codes).toContain('capacity_qualification_missing')
    expect(evidence.r5RearmAuthorized).toBe(false)
    expect(evidence.r5RestartPerformed).toBe(false)
    expect(evidence.mainnetEnabled).toBe(false)
  })

  it('permits candidacy only with a current explicit post-reclaim growth/capacity proof', () => {
    const databaseGuard = databaseGuardFixture()
    const evidence = runAssessment(
      databaseGuard,
      0,
      capacityQualificationFixture(databaseGuard),
    )
    expect(evidence.candidateForSeparateRearmAuthorization).toBe(true)
    expect(evidence.blockerCount).toBe(0)
    expect(evidence.productionDatabaseReadOnly).toBe(true)
    expect(evidence.productionMutationAuthorized).toBe(false)
    expect(evidence.schedulerMutationAuthorized).toBe(false)
    expect(evidence.r5RearmAuthorized).toBe(false)
    expect(evidence.r5RestartPerformed).toBe(false)
    expect(evidence.mainnetEnabled).toBe(false)
    expect(evidence.reviewedExecutionCommit).toBe(guard.executionCommit)
    expect(evidence.reviewedAtomicBundleSha256).toBe(guard.bundleSha256)
  })

  it('rejects stale or unsafe capacity evidence even if the database guard has positive headroom', () => {
    const databaseGuard = databaseGuardFixture()
    const qualification = capacityQualificationFixture(databaseGuard)
    qualification.databaseBytes = 349_000_000
    qualification.databaseHeadroomBytes = 51_000_000
    qualification.sustainedFreeOperationCapacityProblemClosed = false
    qualification.safeForR5Rearm = false
    const evidence = runAssessment(databaseGuard, 0, qualification)
    const codes = evidence.blockers.map((entry: { code: string }) => entry.code)
    expect(evidence.candidateForSeparateRearmAuthorization).toBe(false)
    expect(codes).toContain('free_operation_capacity_problem_open')
    expect(codes).toContain('capacity_qualification_rearm_not_safe')
    expect(codes).toContain('capacity_qualification_database_state_stale')
    expect(codes).toContain('capacity_qualification_headroom_state_stale')
    expect(evidence.r5RearmAuthorized).toBe(false)
    expect(evidence.mainnetEnabled).toBe(false)
  })

  it('fails readiness closed on database-guard failure without converting the assessment into an authorization', () => {
    const databaseGuard = databaseGuardFixture({ databaseBytes: 401_000_000, databaseHeadroomBytes: -1_000_000 })
    const evidence = runAssessment(
      databaseGuard,
      1,
      capacityQualificationFixture(databaseGuard),
    )
    const codes = evidence.blockers.map((entry: { code: string }) => entry.code)
    expect(evidence.candidateForSeparateRearmAuthorization).toBe(false)
    expect(codes).toContain('database_guard_verify_failed')
    expect(codes).toContain('database_headroom_not_positive')
    expect(evidence.r5RearmAuthorized).toBe(false)
    expect(evidence.mainnetEnabled).toBe(false)
  })
})
