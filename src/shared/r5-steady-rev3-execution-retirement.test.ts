import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const manager = readFileSync(
  resolve(process.cwd(), 'scripts/manage-r5-steady-rev3-execution-retirement.mjs'),
  'utf8',
)
const sql = readFileSync(
  resolve(process.cwd(), 'ops/production-sql/20260825172000_xrpl_steady_rev3_execution_retirement.sql'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-legacy-rev3-execution-retirement.yml'),
  'utf8',
)

const retiredSignatures = [
  'public.xrpl_prepare_network_steady_session(text,timestamp with time zone)',
  'public.xrpl_claim_network_steady_tick(text,timestamp with time zone,timestamp with time zone,integer)',
  'public.xrpl_record_revision3_tick_accounting(text,text,timestamp with time zone,text,jsonb)',
  'public.xrpl_complete_network_steady_tick(text,text,timestamp with time zone,text,text,numeric,numeric,numeric)',
  'public.xrpl_begin_revision3_attempt(text,text,timestamp with time zone,timestamp with time zone)',
  'public.xrpl_finalize_revision3_attempt(text,text,text,text,bigint,text,text,timestamp with time zone)',
  'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()',
  'xrpl_resource_guard_v2.qualify_transfer_on_completion()',
]

describe('steady revision-3 execution retirement', () => {
  it('drops only the exact remaining rev3 trigger and retires the eight measured surfaces', () => {
    expect(sql).toContain('drop trigger xrpl_revision3_transfer_after_attempt_finalization')
    expect(sql).toContain('on xrpl_resource_guard_v2.attempts;')
    expect((sql.match(/\bdrop\s+trigger\b/giu) ?? [])).toHaveLength(1)
    expect(sql).not.toMatch(/\bdrop\s+(function|table|schema|index|view|materialized)\b/iu)

    for (const signature of retiredSignatures) {
      expect(manager).toContain(`signature: '${signature}'`)
      expect(sql).toContain(`revoke all privileges on function ${signature}`)
    }
    expect(sql).not.toContain('revoke all privileges on function public.xrpl_qualify_revision3_accounting_transfer')
    expect(sql).not.toContain('revoke all privileges on function public.xrpl_restore_revision3_accounting_state')
  })

  it('preserves rows, restore data, scheduler, deployment, and physical storage', () => {
    expect(sql).not.toMatch(/\b(delete|insert|update|alter|truncate|vacuum|create|grant)\b/iu)
    expect(manager).toContain('rowMutationAuthorized: false')
    expect(manager).toContain('restoreSchemaMutationAuthorized: false')
    expect(manager).toContain('physicalCompactionAuthorized: false')
    expect(manager).toContain('schedulerMutationAuthorized: false')
    expect(manager).toContain('deploymentAuthorized: false')
    expect(manager).toContain('r5RearmAuthorized: false')
    expect(manager).toContain("'restoreTargets',(select count(*) from xrpl_resource_restore_v1.targets)")
    expect(manager).toContain("'restoreAttemptRows',(select count(*) from xrpl_resource_restore_v1.attempt_rows)")
    expect(manager).toContain("'restoreAccountingRows',(select count(*) from xrpl_resource_restore_v1.accounting_rows)")
  })

  it('requires one exact trigger binding and an otherwise inert rev3 runtime before prepare/apply', () => {
    expect(manager).toContain("if (Number(state.activeLegacyCronJobs) !== 0) fail('legacy steady cron is active')")
    expect(manager).toContain("if (Number(state.runningGuardedSessions) !== 0) fail('guarded steady session is running')")
    expect(manager).toContain("fail('legacy steady lease remains')")
    expect(manager).toContain("if (Number(state.openAttempts) !== 0) fail('revision-3 open attempt remains')")
    expect(manager).toContain("bindings.length !== 1 || !expectedTriggerBinding(bindings[0])")
    expect(manager).toContain("triggerName: 'xrpl_revision3_transfer_after_attempt_finalization'")
    expect(manager).toContain("tableSchema: 'xrpl_resource_guard_v2'")
    expect(manager).toContain("tableName: 'attempts'")
    expect(manager).toContain("functionName: 'qualify_transfer_after_attempt_finalization'")
  })

  it('keeps the new lane state-bound and without a wall-clock expiry', () => {
    expect(workflow).toContain("github.event.comment.body == '/r5-steady-rev3-execution-retirement-prepare'")
    expect(workflow).toContain("startsWith(github.event.comment.body, '/r5-steady-rev3-execution-retirement-authorize ')")
    expect(workflow).toContain('This is state-bound and one-shot; it has no wall-clock expiry.')
    expect(workflow).toContain('prepare_run=${GITHUB_RUN_ID} nonce=${nonce}')
    expect(workflow).not.toContain('/r5-steady-rev3-execution-retirement-authorize commit=${SOURCE_COMMIT} manager=${MANAGER_SHA} plan=${PLAN_SHA} state=${STATE_SHA} project=${PROJECT_DIGEST} head=${MIGRATION_HEAD} prepare_run=${GITHUB_RUN_ID} expires=')
  })

  it('revalidates the exact state before mutation and verifies trigger removal after it', () => {
    expect(workflow).toContain("test \"$(jq -r '.planDigestSha256' /tmp/steady-pre.json)\" = \"$AUTH_PLAN\"")
    expect(workflow).toContain("test \"$(jq -r '.structuralStateSha256' /tmp/steady-pre.json)\" = \"$AUTH_STATE\"")
    expect(workflow).toContain("test \"$(jq -r '.maxMigrationVersion' /tmp/steady-pre.json)\" = \"$AUTH_HEAD\"")
    expect(workflow).toContain("test \"$(jq -r '.transferTriggerBindingCount' /tmp/steady-pre.json)\" = 1")
    expect(workflow).toContain("test \"$(jq -r '.transferTriggerBindingsAfter | length' \"$file\")\" = 0")
    expect(manager).toContain("fail('authorized retirement state or plan drifted')")
    expect(manager).toContain('before.protectedCounts, after.counts')
  })
})
