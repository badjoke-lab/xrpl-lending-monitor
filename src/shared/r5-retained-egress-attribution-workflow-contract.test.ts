import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const workflow = read('.github/workflows/r5-bounded-recovery-burst.yml')
const diagnostic = read(
  'scripts/diagnose-supabase-r5-retained-egress-attribution.mjs',
)
const attributionJob = workflow.slice(
  workflow.indexOf('  diagnose-r5-retained-egress-attribution:'),
)

describe('R5 retained egress attribution workflow contract', () => {
  it('binds the diagnostic to one exact owner command', () => {
    for (const required of [
      'diagnose-r5-retained-egress-attribution:',
      "github.event_name == 'issue_comment'",
      'github.event.issue.number == 1175',
      "github.actor == 'badjoke-lab'",
      "github.event.comment.body == '/r5-recovery attribute-egress nonce-7f2c5d91'",
      "test \"$R5_ATTRIBUTION_COMMAND\" = '/r5-recovery attribute-egress nonce-7f2c5d91'",
      'node-version: 24.18.0',
      'node scripts/diagnose-supabase-r5-retained-egress-attribution.mjs',
      'supabase-r5-retained-egress-attribution',
    ]) {
      expect(attributionJob).toContain(required)
    }
  })

  it('keeps attribution outside the production recovery executor', () => {
    const executeCondition = workflow.slice(
      workflow.indexOf('  execute-bounded-burst:'),
      workflow.indexOf(
        '    runs-on: ubuntu-latest',
        workflow.indexOf('  execute-bounded-burst:'),
      ),
    )
    expect(executeCondition).not.toContain('attribute-egress')
    expect(attributionJob).not.toContain(
      'node scripts/run-supabase-r5-recovery-burst-contention-aware.mjs',
    )
    expect(attributionJob).not.toContain('supabase secrets set')
    expect(attributionJob).not.toContain('gh issue comment')
  })

  it('uses read-only management queries and retained tables only', () => {
    for (const required of [
      'read_only: true',
      'xrpl_resource_guard_v2.attempts',
      'xrpl_resource_guard_v2.tick_accounting',
      'xrpl_r5_v1.recovery_batches',
      'b.ledger_count',
      'public.xrpl_phase_payload_chunks',
      'public.xrpl_phase_reference_rows',
      'summarizeR5RecoveryEgressAttribution',
      'recoveryAttributionReconciles',
      'providerEgressClaimed: false',
      'unavailableExactInputs',
    ]) {
      expect(diagnostic).toContain(required)
    }
  })

  it('contains no database mutation, deployment, or privileged runtime key', () => {
    for (const forbidden of [
      'insert into',
      'update public.',
      'update xrpl_r5_v1.',
      'delete from',
      'truncate ',
      'vacuum ',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_DB_PASSWORD',
      'supabase secrets set',
      'supabase db',
      'supabase functions deploy',
      'wrangler deploy',
      "MAINNET_ENABLED: 'true'",
    ]) {
      expect(diagnostic.toLowerCase()).not.toContain(forbidden.toLowerCase())
      expect(attributionJob.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
