import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const verifier = read('scripts/verify-supabase-operator-independence.mjs')
const resourceVerifier = read('scripts/verify-supabase-resource-headroom-guard.mjs')
const resourcePublisher = read('scripts/publish-supabase-resource-run-locator.mjs')
const operatorPublisher = read('scripts/publish-supabase-operator-run-locator.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')

describe('Supabase G9 operator-independence contract', () => {
  it('binds the exact revision-3 profile and remote accounting evidence', () => {
    for (const required of [
      "const profileId = 'supabase_free_postgres_pgcron_edge'",
      'const profileRevision = 3',
      "const profileIdentityDigest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'",
      "readEvidence('verified-revision3-accounting.json')",
      "revision3Accounting.purpose !== 'r4c3-supabase-revision3-accounting-verification'",
      'revision3Accounting.completedTicks !== 6',
      'revision3Accounting.committedLedgers !== 144',
      'revision3Accounting.unsafeAccountingAttempts !== 0',
      'allSevenInjectedPrecommitFailuresRejected',
      'revision3AccountingRemotelyProved: true',
      'exactProfileRevisionBound: true',
      'g9Qualified: true',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(verifier).toContain(required)
  })

  it('requires the exact scripted deployment set and migration application', () => {
    for (const slug of [
      'xrpl-collector-tick',
      'xrpl-committed-reader',
      'xrpl-historical-witness',
      'xrpl-historical-witness-reader',
      'xrpl-multichunk-witness',
      'xrpl-multichunk-witness-reader',
      'xrpl-complete-state-transfer',
      'xrpl-restore-continuation',
      'xrpl-remote-fault-qualification',
      'xrpl-throughput-resource-baseline',
      'xrpl-catchup-throughput',
      'xrpl-steady-batch-tick',
      'xrpl-steady-throughput-qualification',
      'xrpl-resource-headroom-guard',
    ]) expect(verifier).toContain(`'${slug}'`)

    for (const required of [
      'uses: actions/checkout@v4',
      'uses: supabase/setup-cli@',
      'supabase link --project-ref',
      'supabase db push --linked --yes',
      'exactFunctionDeploymentSet: true',
      'noRoutineDashboardStep:',
    ]) expect(verifier).toContain(required)
    expect(verifier).toContain('workflow function deployment count changed')
  })

  it('requires scripted credential rotation exactly once', () => {
    for (const required of [
      'openssl rand -hex 32',
      'echo "::add-mask::${verifier_token}"',
      'supabase secrets set XRPL_READER_VERIFY_TOKEN',
      'tokenRotatedExactlyOnce:',
      'tokenScopedToExactProject:',
      'credentialRotationScripted: true',
    ]) expect(verifier).toContain(required)
  })

  it('accepts only a first empty restore or exact duplicate convergence', () => {
    for (const required of [
      'verified-complete-state-transfer.json',
      'verified-restore-continuation.json',
      'collectionStateIncluded',
      'schedulerStateIncluded',
      'publicationStateIncluded',
      'maintenanceStateIncluded',
      'canonicalTextParity',
      'digestParity',
      'duplicateRestoreConverged',
      'digestTamperRejected',
      'const emptyTargetRestoreObserved = completeState.emptyTargetRestoreObserved === true',
      'const exactDuplicateRestoreObserved =',
      'completeState.firstRestoreDuplicate === true',
      'completeState.duplicateRestoreConverged === true',
      'if (!emptyTargetRestoreObserved && !exactDuplicateRestoreObserved)',
      "restorePath: emptyTargetRestoreObserved ? 'empty_target' : 'exact_duplicate_convergence'",
      'repeatableRestoreConvergenceProved: true',
      'postRestoreContinuationProved',
      'watermarkAdvancedExactlyOne',
      'checkpointScriptedAndRemotelyProved: true',
      'exportScriptedAndRemotelyProved: true',
      'restoreScriptedAndRemotelyProved: true',
    ]) expect(verifier).toContain(required)
  })

  it('requires remote transaction rollback and terminal halt evidence', () => {
    for (const required of [
      'verified-remote-fault-qualification.json',
      'interruptionRollbackProved',
      "eventTypes.includes('rollback-observed')",
      'terminalFailClosedHaltProved',
      "eventTypes.includes('terminal-halt')",
      "remoteFault.stream?.status !== 'halted'",
      'remoteFault.successors.length !== 0',
      'rollbackScriptedAndRemotelyProved: true',
      'haltScriptedAndRemotelyProved: true',
    ]) expect(verifier).toContain(required)
  })

  it('requires automatic artifact and issue evidence publication', () => {
    for (const required of [
      'Upload sanitized remote evidence',
      'Publish sanitized run locator',
      'retention-days: 7',
      'gh issue comment 1109',
      'group: supabase-remote-probe-deploy',
      'cancel-in-progress: false',
      'alwaysUploadEvidence:',
      'alwaysPublishLocator:',
      'issueCommentExactlyOnce:',
      'evidenceScripted: true',
    ]) expect(verifier).toContain(required)
  })

  it('publishes sanitized G9 success and failure boundaries', () => {
    expect(resourcePublisher).toContain(
      "await import('./publish-supabase-operator-run-locator.mjs')",
    )
    for (const required of [
      'verified-operator-independence.json',
      'failed-operator-independence.json',
      'R4C2d G9 operator independence',
      'operator-independence verifier: `success`',
      'operator-independence verifier: `failed`',
      'G9 qualified',
      'G8 qualified',
      'profile selected',
    ]) expect(operatorPublisher).toContain(required)
  })

  it('runs after revision-3 resource evidence and is uploaded by the existing workflow', () => {
    expect(resourceVerifier).toContain(
      "await import('./verify-supabase-revision3-accounting.mjs')",
    )
    expect(resourceVerifier).toContain(
      "await import('./verify-supabase-operator-independence.mjs')",
    )
    expect(resourceVerifier.indexOf('verify-supabase-revision3-accounting.mjs')).toBeLessThan(
      resourceVerifier.indexOf('verify-supabase-operator-independence.mjs'),
    )
    expect(workflow).toContain('path: supabase-remote-probe-evidence')
    expect(verifier).toContain('verified-operator-independence.json')
    expect(verifier).toContain('failed-operator-independence.json')
  })
})
