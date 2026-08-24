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
    databaseBytes: 395_000_000,
    databaseHaltBytes: 400_000_000,
    databaseHeadroomBytes: 5_000_000,
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

function runAssessment(databaseGuard: Record<string, unknown>, databaseGuardExit = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'r5-post-terminal-readiness-'))
  const terminalPath = join(dir, 'terminal.json')
  const databaseGuardPath = join(dir, 'database-guard.json')
  const outputPath = join(dir, 'readiness.json')
  writeFileSync(terminalPath, JSON.stringify(terminalFixture()))
  writeFileSync(databaseGuardPath, JSON.stringify(databaseGuard))
  execFileSync(
    process.execPath,
    [
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
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  )
  return JSON.parse(readFileSync(outputPath, 'utf8'))
}

describe('R5 post-terminal apply rearm readiness', () => {
  it('marks a clean read-only state only as a candidate for separate rearm authorization', () => {
    const evidence = runAssessment(databaseGuardFixture())
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

  it('fails readiness closed without converting the assessment into an authorization', () => {
    const evidence = runAssessment(
      databaseGuardFixture({ databaseBytes: 401_000_000, databaseHeadroomBytes: -1_000_000 }),
      1,
    )
    const codes = evidence.blockers.map((entry: { code: string }) => entry.code)
    expect(evidence.candidateForSeparateRearmAuthorization).toBe(false)
    expect(codes).toContain('database_guard_verify_failed')
    expect(codes).toContain('database_headroom_not_positive')
    expect(evidence.r5RearmAuthorized).toBe(false)
    expect(evidence.mainnetEnabled).toBe(false)
  })
})
