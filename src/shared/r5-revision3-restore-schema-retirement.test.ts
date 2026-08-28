import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'ops/production-sql/20260827153500_xrpl_revision3_restore_schema_retirement.sql'),
  'utf8',
)
const manager = readFileSync(
  resolve(process.cwd(), 'scripts/manage-r5-revision3-restore-schema-retirement.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-revision3-restore-schema-retirement.yml'),
  'utf8',
)
const policy = readFileSync(
  resolve(process.cwd(), 'scripts/extend-actions-policy-r5-revision3-restore-schema-retirement.py'),
  'utf8',
)
const policyChain = readFileSync(
  resolve(process.cwd(), 'scripts/extend-actions-policy-r5-terminal-certificate-archive-bounded-apply.py'),
  'utf8',
)

describe('revision-3 restore schema retirement', () => {
  it('uses the exact no-CASCADE five-function three-table one-schema DROP plan', () => {
    const normalized = sql.toLowerCase().replace(/\s+/gu, ' ').trim()
    expect(normalized).toBe(
      [
        'drop function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization();',
        'drop function xrpl_resource_guard_v2.qualify_transfer_on_completion();',
        'drop function public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone);',
        'drop function public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone);',
        'drop function xrpl_resource_restore_v1.build_restored_accounting_state(text);',
        'drop table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets;',
        'drop schema xrpl_resource_restore_v1;',
      ].join(' '),
    )
    expect(normalized.match(/\bdrop function\b/gu) ?? []).toHaveLength(5)
    expect(normalized.match(/\bdrop table\b/gu) ?? []).toHaveLength(1)
    expect(normalized.match(/\bdrop schema\b/gu) ?? []).toHaveLength(1)
    for (const forbidden of [
      /\bcascade\b/iu,
      /\bif\s+exists\b/iu,
      /\bdelete\b/iu,
      /\btruncate\b/iu,
      /\bupdate\b/iu,
      /\binsert\b/iu,
      /\balter\b/iu,
      /\bgrant\b/iu,
      /\brevoke\b/iu,
      /\bvacuum\b/iu,
      /\breindex\b/iu,
      /\bcluster\b/iu,
    ]) {
      expect(sql).not.toMatch(forbidden)
    }
  })

  it('pins every production function source and exact catalog dependency edge', () => {
    for (const signature of [
      'public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)',
      'public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)',
      'xrpl_resource_restore_v1.build_restored_accounting_state(text)',
      'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()',
      'xrpl_resource_guard_v2.qualify_transfer_on_completion()',
    ]) {
      expect(manager).toContain(signature)
    }
    for (const sourceSha of [
      '301e4b7c2c6b229330a8b291b489987c12b2302389b0c3470a4878978757b990',
      '835d6200b8897889553b9d857fbad4c61b33a3eab0f3fad4dec9013f70909187',
      'c920ed138140e4698f707a0702ed6d478d3de0ac779ccd14055ac82838f8d5d6',
      'e855f67c4847cdf0f472f468471bfec78e2f6ce6e0e58a846322f782d52e104b',
      'bac17dd7f28fb056053a064aa1d34de0d7bd8264181b271f20afcb32224b443f',
    ]) {
      expect(manager).toContain(sourceSha)
    }
    expect(manager).toContain('const EXPECTED_DEPENDENCIES = new Set([')
    expect(manager).toContain("if (deps.length !== EXPECTED_DEPENDENCIES.size) fail('retirement dependency inventory drifted')")
    expect(manager).toContain("if ((state.triggerBindings ?? []).length !== 0) fail('retirement target still has trigger binding')")
    expect(manager).toContain("if ((state.referencingViews ?? []).length !== 0) fail('retirement target still has referencing view')")
  })

  it('requires zero restore/runtime state and locks every protected boundary before DROP', () => {
    expect(manager).toContain("fail('revision-3 restore rows are not empty')")
    expect(manager).toContain("if (Number(state.activeLegacyCronJobs) !== 0)")
    expect(manager).toContain("if (Number(state.runningGuardedSessions) !== 0)")
    expect(manager).toContain("if (Number(state.leasedTicks) !== 0 || Number(state.liveLeasedTicks) !== 0)")
    expect(manager).toContain("if (Number(state.openAttempts) !== 0)")
    expect(manager).toContain(
      'lock table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets in access exclusive mode',
    )
    expect(manager).toContain(
      'xrpl_resource_guard_v2.attempts, xrpl_resource_guard_v2.tick_accounting, xrpl_resource_guard_v2.transfer_qualifications in share mode',
    )
    expect(manager).toContain('set local role supabase_admin;')
    expect(manager).toContain('lock table cron.job, supabase_migrations.schema_migrations in share mode')
    expect(manager).toContain('reset role;')
    expect(manager).toContain("const lockCapability = await inspectLockCapability()")
    expect(manager).toContain("fail('extension-owned share-lock capability unavailable')")
    expect(manager).toContain('extensionOwnedShareLockVerified: true')
    expect(manager).toContain("raise exception 'migration head changed under lock'")
    expect(manager).toContain("raise exception 'minute scheduler changed under lock'")
  })

  it('has exactly one production write request and independent read-only post verification', () => {
    expect(manager.match(/managementQuery\(bundle, false\)/gu) ?? []).toHaveLength(1)
    expect(manager).toContain('async function inspectBefore() { return stateRow(await managementQuery(beforeSql(), true)) }')
    expect(manager).toContain('async function inspectAfter() { return stateRow(await managementQuery(afterSql(), true)) }')
    expect(manager).toContain('async function inspectLockCapability() { return stateRow(await managementQuery(lockCapabilitySql(), true)) }')
    expect(manager).toContain("if (!same(before.protectedDigests, after.protectedDigests))")
    expect(manager).toContain("if (before.maxMigrationVersion !== after.maxMigrationVersion)")
    expect(manager).toContain("if (before.schedulerSha256 !== sha(JSON.stringify(after.scheduler)))")
    expect(manager).toContain("if (!same(applied.protectedDigestsBefore, state.protectedDigests))")
    for (const expected of [
      'functionDropPerformed: true',
      'exactFunctionDropCount: 5',
      'tableDropPerformed: true',
      'exactTableDropCount: 3',
      'schemaDropPerformed: true',
      'cascadePerformed: false',
      'rowMutationPerformed: false',
      'schedulerMutationPerformed: false',
      'deploymentPerformed: false',
      'publicReaderMutationPerformed: false',
      'r5RearmPerformed: false',
      'mainnetDisabled: true',
      'postVerificationReadOnly: true',
    ]) {
      expect(manager).toContain(expected)
    }
  })

  it('requires exact owner prepare/authorization provenance before mutation', () => {
    expect(workflow).toContain("github.event.comment.body == '/r5-revision3-restore-schema-retirement-prepare'")
    expect(workflow).toContain("startsWith(github.event.comment.body, '/r5-revision3-restore-schema-retirement-authorize ')")
    expect(workflow).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(workflow).toContain('Verify exact prior proposal and unique owner authorization')
    expect(workflow).toContain("c?.user?.login==='github-actions[bot]'")
    expect(workflow).toContain("c?.user?.login==='badjoke-lab'&&c?.body===expected")
    expect(workflow).toContain('test $((expires_epoch - auth_epoch)) -le 7200')
    expect(workflow).toContain('Revalidate exact authorized restore schema retirement state read-only')
    expect(workflow).toContain('Apply exact no-CASCADE restore schema retirement')
    expect(workflow).toContain('Independent post-commit read-only verify')
  })

  it('extends the minimal Actions surface from forty-four to forty-five', () => {
    expect(policy).toContain('r5-revision3-restore-schema-retirement.yml')
    expect(policy).toContain('exactly forty-four')
    expect(policy).toContain('exactly forty-five')
    expect(policy).toContain('r5_revision3_restore_schema_retirement: ["issue_comment"]')
    expect(policy).toContain('managementQuery(bundle, false)')
    expect(policyChain).toContain(
      "subprocess.run([sys.executable, 'scripts/extend-actions-policy-r5-revision3-restore-schema-retirement.py', sys.argv[1]], check=True)",
    )
  })
})
