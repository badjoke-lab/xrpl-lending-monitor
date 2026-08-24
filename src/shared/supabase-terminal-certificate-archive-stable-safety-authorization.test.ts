import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const guardPath = resolve(
  process.cwd(),
  'ops/production-sql/20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json',
)
const preparePath = resolve(
  process.cwd(),
  'ops/production-sql/20260824012500_xrpl_terminal_certificate_archive_atomic_prepare_contract.json',
)
const priorPath = resolve(
  process.cwd(),
  'ops/production-sql/20260824030000_xrpl_terminal_certificate_archive_state_bound_authorization_contract.json',
)

const guard = JSON.parse(readFileSync(guardPath, 'utf8'))
const prepare = JSON.parse(readFileSync(preparePath, 'utf8'))
const prior = JSON.parse(readFileSync(priorPath, 'utf8'))

describe('terminal certificate/archive stable-safety OWNER authorization', () => {
  it('preserves the reviewed mutation identity while superseding the volatile full-prestate binding', () => {
    expect(guard.supersedes).toBe(
      'ops/production-sql/20260824030000_xrpl_terminal_certificate_archive_state_bound_authorization_contract.json',
    )
    expect(guard.executionCommit).toBe(prior.executionCommit)
    expect(guard.bundleSha256).toBe(prior.bundleSha256)
    expect(guard.projectIdentityDigest).toBe(prior.projectIdentityDigest)
    expect(guard.prepareRun).toBe(prior.prepareRun)
    expect(guard.nonce).toBe(prior.nonce)
  })

  it('copies only safety-critical before-state invariants from the reviewed prepare contract', () => {
    expect(guard.stableSafetyGuard.columnsMustBeAbsent).toEqual(
      prepare.expectedBefore.applyPreflightRequirements.columnsMustBeAbsent,
    )
    expect(guard.stableSafetyGuard.functionDefinitionSha256).toEqual(
      prepare.expectedBefore.functionDefinitionSha256,
    )
    expect(guard.stableSafetyGuard.duplicateCompletion).toEqual(
      prepare.expectedBefore.duplicateCompletion,
    )
    expect(guard.stableSafetyGuard.identityHelperDefinitionSha256).toEqual(
      prepare.expectedBefore.identityHelperDefinitionSha256,
    )
    expect(guard.stableSafetyGuard.transportDuplicateMessageIdsMustRemain).toBe(
      prepare.productionEvidence.prestate.transportDuplicateMessageIds,
    )
    expect(guard.stableSafetyGuard.historicalNonzeroSourceScanSequencesMustRemain).toBe(
      prepare.productionEvidence.prestate.scanSequenceNonzeroRows,
    )
    expect(guard.stableSafetyGuard.activeScanSequencesMustRemain).toEqual(
      prepare.productionEvidence.prestate.activeScanSequences,
    )
    expect(guard.stableSafetyGuard.productiveMappingDigestMustRemain).toBe(
      prepare.productionEvidence.prestate.productiveMappingDigest,
    )
  })

  it('does not let ordinary measurement drift invalidate owner authorization', () => {
    const excluded = new Set(guard.volatileEvidenceExcludedFromAuthorizationValidity)
    for (const key of [
      'databaseBytes',
      'transportRows',
      'completedScanRows',
      'productiveScanRows',
      'caughtUpScanRows',
      'unknownScanRows',
    ]) {
      expect(excluded.has(key)).toBe(true)
      expect(guard.stableSafetyGuard).not.toHaveProperty(key)
    }
    expect(guard.validity.wallClockExpiryRequired).toBe(false)
    expect(guard.validity.volatileMeasurementDriftInvalidatesAuthorization).toBe(false)
    expect(guard.command).not.toContain('expires=')
    expect(guard.command).not.toContain(`state=${prepare.productionEvidence.prestateSha256}`)
  })

  it('binds one exact stable guard command and retains fail-closed mutation boundaries', () => {
    expect(guard.command).toBe(
      `/r5-terminal-certificate-archive-authorize commit=${guard.executionCommit}` +
        ` bundle=${guard.bundleSha256}` +
        ` guard=${guard.guardId}` +
        ` project=${guard.projectIdentityDigest}` +
        ` prepare_run=${guard.prepareRun}` +
        ` nonce=${guard.nonce}`,
    )
    expect(guard.validity.stableSafetyMismatchFailsClosedBeforeMutation).toBe(true)
    expect(guard.validity.exactBundleMustMatch).toBe(true)
    expect(guard.validity.singleSuccessfulApplyOnly).toBe(true)
    expect(guard.boundedApply).toEqual({
      authorizedOnlyAfterExactOwnerCommand: true,
      exactBundleOnly: true,
      singleTransaction: true,
      extraSqlAllowed: false,
      rollbackOnAnyPreflightOrHashFailure: true,
      schedulerMutationAllowed: false,
      deploymentAllowed: false,
      publicReaderMutationAllowed: false,
      archiveDeleteOrStopAllowed: false,
      r5RearmAllowed: false,
      mainnetAllowed: false,
    })
    expect(guard.independentReadOnlyVerifyRequired).toBe(true)
    expect(guard.productionMutationAuthorized).toBe(false)
    expect(guard.productionApplied).toBe(false)
    expect(guard.r5RearmAuthorized).toBe(false)
    expect(guard.mainnetEnabled).toBe(false)
  })
})
