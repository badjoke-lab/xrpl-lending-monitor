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
      "'xrpl_claim_r5_active_recovery_batch_from_prepared_head'",
    )
    const head = executor.indexOf('const head = await readValidatedHead')
    expect(claim).toBeGreaterThan(-1)
    expect(head).toBeGreaterThan(claim)

    for (const required of [
      "const RECOVERY_RUN_ID = 'r5-recovery-selected-revision3-entry'",
      'reservationBeforeAnyNetworkRead !== true',
      'freshHeadMustCoverReservedEndBeforeFetch !== true',
      'validated head ${head.index} is below reserved end ${claim.endLedgerIndex}',
    ]) {
      expect(executor).toContain(required)
    }
  })

  it('binds one variable 1-24 ledger batch to the selected profile', () => {
    for (const required of [
      'claim.ledgerCount < 1',
      'claim.ledgerCount > MAX_BATCH_SIZE',
      'claim.endLedgerIndex !== claim.startLedgerIndex + claim.ledgerCount - 1',
      "claim.network !== 'devnet'",
      "claim.epochId !== 'supabase-r4c2c-v1'",
      'claim.profileRevision !== SUPABASE_REVISION3_PROFILE.revision',
      'claim.profileIdentityDigest !== SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST',
      'claim.selectionDigest !== SELECTION_DIGEST',
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

  it('evaluates revision-3 accounting before atomic completion', () => {
    const accounting = executor.indexOf(
      'evaluateSupabaseRevision3ResourceAccounting(input)',
    )
    const completion = executor.indexOf("'xrpl_complete_r5_active_recovery_batch'")
    expect(accounting).toBeGreaterThan(-1)
    expect(completion).toBeGreaterThan(accounting)

    for (const required of [
      'const COMPLETION_REQUEST_RESERVE_BYTES = 2 * 1024 * 1024',
      'databaseRequestBytes:',
      '+ COMPLETION_REQUEST_RESERVE_BYTES',
      'priorConservativeEgress31dBytes: claim.priorConservativeEgress31dBytes',
      'priorInvocations31d: claim.priorInvocations31d',
      'accountingResult.projectedInvocations31d !== claim.projectedInvocations31d',
      'completionBodyBytes > COMPLETION_REQUEST_RESERVE_BYTES',
      'p_finalized_egress_upper_bound_bytes:',
      'accountingResult.conservativeTickEgressUpperBoundBytes',
    ]) {
      expect(executor).toContain(required)
    }
  })

  it('leaves transient failures reclaimable and halts only terminal failures', () => {
    for (const required of [
      'class RecoveryError extends Error',
      'readonly terminal: boolean',
      'throw new RecoveryError(',
      'false,',
      'if (claim !== null && recoveryError.terminal)',
      "'xrpl_fail_r5_active_recovery_batch'",
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
    ]) {
      expect(executor).toContain(required)
    }
    expect(config).toContain('[functions.xrpl-r5-recovery-batch]')
    expect(config).toContain('[functions.xrpl-r5-recovery-batch]\nverify_jwt =false')
  })
})
