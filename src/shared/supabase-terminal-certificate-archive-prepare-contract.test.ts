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

  it('binds fresh current-main read-only production evidence to a deterministic prestate digest', () => {
    expect(contract.productionEvidence.readOnlyRunId).toBe(32677209901)
    expect(contract.productionEvidence.sourceCommit).toBe(
      'ff4d98149ca29d7b03aca960776fba06d5766fc1',
    )
    expect(contract.productionEvidence.sourceCommit).not.toBe(contract.executionCommit)
    expect(contract.productionEvidence.artifactId).toBe(9503059510)
    expect(contract.productionEvidence.artifactDigestSha256).toBe(
      '4b8d4a2d3f504ca61ee258318bdbb61be421602d3dd06fc35daeae3d6bc9ee08',
    )
    expect(contract.productionEvidence.scanSequenceEvidenceSha256).toBe(
      '78df54d7dce718e5f8e64de0fec6fdc674cbd6a33f33c06c6e9f6180f86eb66c',
    )
    expect(contract.productionEvidence.transportTargetSourceEvidenceSha256).toBe(
      '20d46469cd03e96f719d47f7d523ab98386849572e6a8bd408461a10f63a88a4',
    )
    expect(contract.productionEvidence.indexEvidenceSha256).toBe(
      '7d8212caeb8d2967e39db761f2ce0ebaa1ef75cb8563de74ab92440b278b59c4',
    )
    expect(contract.productionEvidence.prestate.sourceCommit).toBe(
      contract.productionEvidence.sourceCommit,
    )
    expect(contract.productionEvidence.prestate.readOnlyRunId).toBe(32677209901)
    expect(contract.productionEvidence.prestate.artifactDigestSha256).toBe(
      contract.productionEvidence.artifactDigestSha256,
    )
    expect(contract.productionEvidence.prestate.databaseBytes).toBe(395857043)
    expect(contract.productionEvidence.prestate.transportRows).toBe(51732)
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
      '88985e1f77738ddf3283121028879a96213ee0137c491e4eb06ecc712d5c9fe9',
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
    expect(contract.expectedBefore.duplicateCompletion.sourceSha256).toBe(
      'aa5b972f1245fc46239164247a0203c67dac7be21a3f561009a930e50784a081',
    )
    expect(stageText).toContain(contract.expectedAfter.duplicateCompletion.sourceSha256)
    expect(stageText).toContain('source_scan_sequence integer not null default 0')
    expect(stageText).toContain('next_scan_sequence integer not null default 0')
  })

  it('makes the refreshed owner authorization proposal exact, one-time and non-self-authorizing', () => {
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
    expect(proposal.expires).toBe('2026-08-24T02:00:00Z')
    expect(proposal.nonce).toBe('f96f6bfd2f84c3ae')
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
    expect(text).not.toContain('"productionApplied": true')
    expect(text).not.toContain('"productionMutationAuthorized": true')
  })
})
