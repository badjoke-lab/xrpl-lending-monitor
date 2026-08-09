import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const executor = readFileSync(
  resolve(process.cwd(), 'supabase/functions/xrpl-r5-recovery-batch/index.ts'),
  'utf8',
)
const config = readFileSync(resolve(process.cwd(), 'supabase/config.toml'), 'utf8')

describe('R5 active recovery batch executor contract', () => {
  it('claims and reserves before the first XRPL network read', () => {
    const claim = executor.indexOf(
      "'xrpl_claim_r5_revision4_recovery_batch_from_prepared_head'",
    )
    const head = executor.indexOf('const head = await readValidatedHead')
    expect(claim).toBeGreaterThan(-1)
    expect(head).toBeGreaterThan(claim)

    for (const required of [
      "const RECOVERY_RUN_ID = 'r5-recovery-selected-revision4-entry'",
      'reservationBeforeAnyNetworkRead !== true',
      'freshHeadMustCoverReservedEndBeforeFetch !== true',
      'validated head ${head.index} is below reserved end ${claim.endLedgerIndex}',
    ]) {
      expect(executor).toContain(required)
    }
  })

  it('binds one variable 1-12 ledger batch to the revision-4 profile and explicit selection', () => {
    for (const required of [
      'claim.ledgerCount < 1',
      'claim.ledgerCount > SUPABASE_REVISION4_R5_RUNTIME_LIMITS.selectedMaximumLedgersPerClaim',
      'claim.endLedgerIndex !== claim.startLedgerIndex + claim.ledgerCount - 1',
      "claim.network !== 'devnet'",
      "claim.epochId !== 'supabase-r4c2c-v1'",
      'claim.profileRevision !== SUPABASE_REVISION4_PROFILE.revision',
      'claim.profileIdentityDigest !== SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST',
      'claim.selectionDigest !== expectedSelectionDigest',
      '{ length: claim.ledgerCount }',
      'FETCH_CONCURRENCY',
    ]) {
      expect(executor).toContain(required)
    }
  })

  it('verifies hash continuity and canonical portable payloads', () => {
    for (const required of [
      'ledger.parentHash !== expectedParentHash',
      'finalLedger.ledgerHash !== head.hash',
      'buildPortableCollectorWorkId',
      'buildPortableXrplNormalizedWork',
      'portableReferenceRowsFromChunk',
      'canonicalPortableJson(works)',
      'const worksDigest = await sha256Hex(worksJson)',
    ]) {
      expect(executor).toContain(required)
    }
  })

  it('evaluates revision-4 directional accounting before atomic completion', () => {
    const accounting = executor.indexOf(
      'resolveSupabaseRevision4R5CompletionFixedPoint',
    )
    const completion = executor.indexOf("'xrpl_complete_r5_revision4_recovery_batch'")
    expect(accounting).toBeGreaterThan(-1)
    expect(completion).toBeGreaterThan(accounting)

    for (const required of [
      'COMPLETION_REQUEST_MAX_BYTES = 2 * 1024 * 1024',
      'COMPLETION_RESPONSE_ACCOUNTING_RESERVE_BYTES = 4 * 1024',
      'databaseRequestBytesBeforeCompletion: meter.databaseRequestBytes',
      'priorConservativeEgress31dBytes',
      'projectedInvocations31d >= SUPABASE_REVISION4_FIXED_GUARDS.projectInvocationHalt31d',
      'resolved.completionRequestBytes > COMPLETION_REQUEST_MAX_BYTES',
      'p_finalized_egress_upper_bound_bytes: finalizedEgressUpperBoundBytes',
      'accounting.rollingBillableEgressUpperBoundBytes',
      'projectedEgress31dBytes',
    ]) {
      expect(executor).toContain(required)
    }
    expect(executor).not.toContain('evaluateSupabaseRevision3ResourceAccounting')
  })

  it('leaves transient failures reclaimable and halts only terminal failures', () => {
    for (const required of [
      'class RecoveryError extends Error',
      'readonly terminal: boolean',
      'throw new RecoveryError(',
      'false,',
      'if (claim !== null && recoveryError.terminal)',
      "'xrpl_fail_r5_revision4_recovery_batch'",
      'transient: !recoveryError.terminal',
      'activeMutationCommitted: false',
    ]) {
      expect(executor).toContain(required)
    }
    expect(executor).not.toContain('if (claim !== null) {\n      try {\n        await postRpc')
  })

  it('keeps the function service-key authenticated and cutover boundaries closed', () => {
    for (const required of [
      "request.headers.get('apikey') !== secretKey",
      "body.source !== 'github_actions'",
      "publicReaderUnchanged: true",
      "mainnetDisabled: true",
      "stabilizationNotStarted: true",
      "soakNotStarted: true",
      "env('XRPL_R5_REVISION4_SELECTION_DIGEST')",
      "env('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')",
    ]) {
      expect(executor).toContain(required)
    }
    expect(config).toContain('[functions.xrpl-r5-recovery-batch]')
    expect(config).toContain('[functions.xrpl-r5-recovery-batch]\nverify_jwt =false')
  })
})
