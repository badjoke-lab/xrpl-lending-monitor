import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const successorPath = resolve(
  process.cwd(),
  'ops/production-sql/20260824030000_xrpl_terminal_certificate_archive_state_bound_authorization_contract.json',
)
const preparePath = resolve(
  process.cwd(),
  'ops/production-sql/20260824012500_xrpl_terminal_certificate_archive_atomic_prepare_contract.json',
)

const successor = JSON.parse(readFileSync(successorPath, 'utf8'))
const prepare = JSON.parse(readFileSync(preparePath, 'utf8'))

describe('terminal certificate/archive state-bound OWNER authorization', () => {
  it('supersedes only the old wall-clock proposal while preserving the reviewed mutation identity', () => {
    expect(successor.supersedesAuthorizationProposalIn).toBe(
      'ops/production-sql/20260824012500_xrpl_terminal_certificate_archive_atomic_prepare_contract.json',
    )
    expect(successor.executionCommit).toBe(prepare.executionCommit)
    expect(successor.bundleSha256).toBe(prepare.atomicBundle.bundleSha256)
    expect(successor.prestateSha256).toBe(prepare.productionEvidence.prestateSha256)
    expect(successor.projectIdentityDigest).toBe(prepare.authorizationProposal.projectIdentityDigest)
    expect(successor.prepareRun).toBe(prepare.authorizationProposal.prepareRun)
    expect(successor.nonce).toBe(prepare.authorizationProposal.nonce)
  })

  it('uses state validity instead of an arbitrary wall-clock deadline', () => {
    expect(successor.validity).toEqual({
      mode: 'state-bound-no-wall-clock-expiry',
      wallClockExpiryRequired: false,
      exactPrestateMustMatchAtApply: true,
      exactBundleMustMatch: true,
      singleSuccessfulApplyOnly: true,
      failClosedOnAnyPreflightOrHashMismatch: true,
      supersededByReplacementAuthorization: true,
      revocable: true,
    })
    expect(successor.command).not.toContain(' expires=')
    expect(successor).not.toHaveProperty('expires')
  })

  it('keeps the command exact and non-self-authorizing', () => {
    expect(successor.command).toBe(
      `/r5-terminal-certificate-archive-authorize commit=${successor.executionCommit}` +
        ` bundle=${successor.bundleSha256}` +
        ` state=${successor.prestateSha256}` +
        ` project=${successor.projectIdentityDigest}` +
        ` prepare_run=${successor.prepareRun}` +
        ` nonce=${successor.nonce}`,
    )
    expect(successor.productionMutationAuthorized).toBe(false)
    expect(successor.productionApplied).toBe(false)
  })

  it('retains all bounded-apply and separate-runtime safety boundaries', () => {
    expect(successor.boundedApply).toEqual({
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
    expect(successor.independentReadOnlyVerifyRequired).toBe(true)
    expect(successor.schedulerMutationAuthorized).toBe(false)
    expect(successor.publicReaderMutationAuthorized).toBe(false)
    expect(successor.archiveDeletionAuthorized).toBe(false)
    expect(successor.r5RearmAuthorized).toBe(false)
    expect(successor.mainnetEnabled).toBe(false)
  })
})
