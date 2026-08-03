import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const verifier = read('scripts/verify-supabase-operator-independence.mjs')
const resourceVerifier = read('scripts/verify-supabase-resource-headroom-guard.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')

describe('Supabase G9 operator-independence contract', () => {
  it('binds the exact profile revision and identity digest', () => {
    for (const required of [
      "const profileId = 'supabase_free_postgres_pgcron_edge'",
      'const profileRevision = 2',
      "const profileIdentityDigest = 'c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998'",
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

  it('requires remote checkpoint, export, restore, and continuation evidence', () => {
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
      'emptyTargetRestoreObserved',
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

  it('runs after the resource evidence and is uploaded by the existing workflow', () => {
    expect(resourceVerifier).toContain(
      "await import('./verify-supabase-operator-independence.mjs')",
    )
    expect(resourceVerifier.indexOf('verified-resource-headroom-guard.json')).toBeLessThan(
      resourceVerifier.indexOf('verify-supabase-operator-independence.mjs'),
    )
    expect(workflow).toContain('path: supabase-remote-probe-evidence')
    expect(verifier).toContain('verified-operator-independence.json')
    expect(verifier).toContain('failed-operator-independence.json')
  })
})