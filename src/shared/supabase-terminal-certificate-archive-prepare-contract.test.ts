import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const contractPath = resolve(
  process.cwd(),
  'ops/production-sql/20260824012500_xrpl_terminal_certificate_archive_atomic_prepare_contract.json',
)
const manifestPath = resolve(
  process.cwd(),
  'ops/production-sql/20260823053000_xrpl_terminal_certificate_archive_atomic_manifest.json',
)

const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

describe('terminal certificate/archive production prepare contract', () => {
  it('binds the exact reviewed atomic bundle and immutable execution commit', () => {
    expect(contract.executionCommit).toBe('86f95feadc4edaa640c1d466b8616d6ed1201952')
    expect(contract.atomicBundle).toEqual({
      sourceCommit: manifest.sourceCommit,
      orderedStages: manifest.orderedStages,
      bundleSha256: manifest.bundleSha256,
      transactionBoundaryCount: manifest.transactionBoundaryCount,
    })
    expect(contract.atomicBundle.bundleSha256).toBe(
      'cc83e46fe3c58b2c13549ff35a2df8d4d8ddcf1efac041bd321ce273809aa1db',
    )

    for (const stage of contract.atomicBundle.orderedStages) {
      const bytes = readFileSync(resolve(process.cwd(), stage.path))
      expect(sha256(bytes)).toBe(stage.sha256)
    }
  })

  it('binds fresh read-only production evidence to a deterministic prestate digest', () => {
    expect(contract.productionEvidence.readOnlyRunId).toBe(32651882728)
    expect(contract.productionEvidence.sourceCommit).toBe(contract.executionCommit)
    expect(contract.productionEvidence.artifactDigestSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(contract.productionEvidence.prestate.sourceCommit).toBe(contract.executionCommit)
    expect(contract.productionEvidence.prestate.readOnlyRunId).toBe(32651882728)
    expect(contract.productionEvidence.prestate.databaseBytes).toBe(395857043)
    expect(contract.productionEvidence.prestate.transportDuplicateMessageIds).toBe(0)
    expect(contract.productionEvidence.prestate.completedScanRows).toBe(17063)
    expect(contract.productionEvidence.prestate.productiveScanRows).toBe(17063)
    expect(contract.productionEvidence.prestate.caughtUpScanRows).toBe(0)
    expect(contract.productionEvidence.prestate.unknownScanRows).toBe(0)
    expect(contract.productionEvidence.prestate.scanSequenceNonzeroRows).toBe(0)
    expect(contract.productionEvidence.prestate.activeScanSequences).toEqual([0])
    expect(contract.productionEvidence.prestate.productiveMappingDigest).toBe(
      '53a1c842b41c20efe5c24ab5b858be9a56a7a0b62f9f7029bd300bad00b90cd8',
    )
    expect(sha256(canonicalJson(contract.productionEvidence.prestate))).toBe(
      contract.productionEvidence.prestateSha256,
    )
    expect(contract.productionEvidence.prestateSha256).toBe(
      '0ad9321af1f8dad62439745c1628f283a74cf2a0bdac0a3dc9a07fd2ea3072f2',
    )
  })

  it('locks every staged before and after fingerprint while retaining full helper invariants', () => {
    const stageText = contract.atomicBundle.orderedStages
      .map((stage: { path: string }) => readFileSync(resolve(process.cwd(), stage.path), 'utf8'))
      .join('\n')

    for (const digest of Object.values(contract.expectedBefore.functionDefinitionSha256)) {
      expect(stageText).toContain(digest)
    }
    for (const helper of ['scanMessageId', 'workId', 'commitMessageId']) {
      expect(stageText).toContain(contract.expectedBefore.identityHelperDefinitionSha256[helper])
      expect(contract.expectedAfter.identityHelperDefinitionSha256Unchanged[helper]).toBe(
        contract.expectedBefore.identityHelperDefinitionSha256[helper],
      )
    }
    for (const digest of Object.values(contract.expectedAfter.functionDefinitionSha256)) {
      expect(stageText).toContain(digest)
    }
    expect(contract.expectedAfter.identityHelperDefinitionSha256Unchanged.finalizeMessageId).toBe(
      contract.expectedBefore.identityHelperDefinitionSha256.finalizeMessageId,
    )
    expect(
      contract.productionEvidence.prestate.functionDefinitionSha256[
        'public.xrpl_phase_finalize_message_id(text)'
      ],
    ).toBe(contract.expectedBefore.identityHelperDefinitionSha256.finalizeMessageId)
    expect(stageText).toContain(contract.expectedBefore.duplicateCompletion.sourceSha256)
    expect(stageText).toContain(contract.expectedAfter.duplicateCompletion.sourceSha256)
    expect(stageText).toContain('source_scan_sequence integer not null default 0')
    expect(stageText).toContain('next_scan_sequence integer not null default 0')
  })

  it('makes the owner authorization proposal exact, one-time and non-self-authorizing', () => {
    const proposal = contract.authorizationProposal
    const command = proposal.command as string
    expect(proposal.proposalOnly).toBe(true)
    expect(command).toBe(
      `/r5-terminal-certificate-archive-authorize commit=${contract.executionCommit}` +
        ` bundle=${contract.atomicBundle.bundleSha256}` +
        ` state=${contract.productionEvidence.prestateSha256}` +
        ` project=${proposal.projectIdentityDigest}` +
        ` prepare_run=${proposal.prepareRun}` +
        ` expires=${proposal.expires}` +
        ` nonce=${proposal.nonce}`,
    )
    expect(proposal.prepareRun).toBe(contract.productionEvidence.readOnlyRunId)
    expect(proposal.projectIdentityDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(proposal.nonce).toMatch(/^[a-f0-9]{16}$/u)
    expect(Number.isNaN(Date.parse(proposal.expires))).toBe(false)
    expect(contract.productionMutationAuthorized).toBe(false)
  })

  it('permits only one fail-closed transaction and keeps runtime changes separately unauthorized', () => {
    expect(contract.boundedApply).toEqual({
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
    expect(contract.independentReadOnlyVerify.required).toBe(true)
    expect(contract.independentReadOnlyVerify.mustUseReadOnlyDatabaseAccess).toBe(true)
    expect(contract.independentReadOnlyVerify.r5RearmIsSeparateAuthorization).toBe(true)
    expect(contract.productionApplied).toBe(false)
    expect(contract.schedulerMutationAuthorized).toBe(false)
    expect(contract.publicReaderMutationAuthorized).toBe(false)
    expect(contract.archiveDeletionAuthorized).toBe(false)
    expect(contract.r5RearmAuthorized).toBe(false)
    expect(contract.mainnetEnabled).toBe(false)
  })

  it('adds no automatic production apply surface', () => {
    const text = readFileSync(contractPath, 'utf8')
    expect(text).not.toContain('.github/workflows')
    expect(text).not.toContain('supabase db push')
    expect(text).not.toContain('psql ')
    expect(text).not.toContain('wrangler deploy')
    expect(text).not.toContain('productionApplied\": true')
    expect(text).not.toContain('productionMutationAuthorized\": true')
  })
})
