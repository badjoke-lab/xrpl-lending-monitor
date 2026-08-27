import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'ops/production-sql/20260826161000_xrpl_revision3_restore_data_reclaim.sql'),
  'utf8',
)
const manager = readFileSync(
  resolve(process.cwd(), 'scripts/manage-r5-revision3-restore-data-reclaim.mjs'),
  'utf8',
)

describe('bounded revision-3 restore data reclaim', () => {
  it('uses one exact three-table TRUNCATE and retains schema objects', () => {
    const normalized = sql.toLowerCase().replace(/\s+/gu, ' ').trim()
    expect(normalized).toBe(
      'truncate table xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.targets;',
    )
    expect((normalized.match(/\btruncate\s+table\b/gu) ?? [])).toHaveLength(1)
    for (const table of ['attempt_rows', 'accounting_rows', 'targets']) {
      expect(normalized).toContain(`xrpl_resource_restore_v1.${table}`)
    }
  })

  it('forbids destructive expansion beyond the exact data reclaim', () => {
    for (const forbidden of [
      /\bcascade\b/iu,
      /\brestart\s+identity\b/iu,
      /\bdelete\s+from\b/iu,
      /\binsert\s+into\b/iu,
      /\bupdate\b/iu,
      /\balter\b/iu,
      /\bdrop\b/iu,
      /\bcreate\b/iu,
      /\bgrant\b/iu,
      /\brevoke\b/iu,
      /\bvacuum\b/iu,
      /\breindex\b/iu,
      /\bcluster\b/iu,
    ]) {
      expect(sql).not.toMatch(forbidden)
    }
    expect(manager).toContain("if (normalized !== exact) fail('restore reclaim SQL must be the exact three-table TRUNCATE plan')")
    expect(manager).toContain('/\\bcascade\\b/iu')
    expect(manager).toContain('/\\bdrop\\b/iu')
    expect(manager).toContain('/\\bvacuum\\b/iu')
  })

  it('requires the independent read-only removal verdict before prepare or apply', () => {
    expect(manager).toContain("if (!path) fail('missing --preflight-evidence')")
    expect(manager).toContain("state.reclaimEvidence?.restoreSchemaRemovalProvenSafe !== true")
    expect(manager).toContain("state.reclaimEvidence?.futureRevision3QualificationDemandProvenClosed !== true")
    expect(manager).toContain("state.reclaimEvidence?.allRestoreTargetsDurablyQualified !== true")
    expect(manager).toContain("state.reclaimEvidence?.allTransferQualificationsBelongToCompletedGuardedSessions !== true")
    expect(manager).toContain("state.reclaimEvidence?.noRevision4RuntimeConsumers !== true")
    expect(manager).toContain("state.reclaimEvidence?.noOpenGuardAttempts !== true")
  })

  it('binds authorization to stable semantic preflight state rather than volatile observed time', () => {
    expect(manager).toContain('function semanticPreflightState(envelope, sourceCommit)')
    expect(manager).toContain('querySha256: envelope.querySha256 ?? null')
    expect(manager).toContain('reclaimEvidence: state.reclaimEvidence ?? {}')
    expect(manager).toContain('futureDemandEvidence: state.futureDemandEvidence ?? {}')
    expect(manager).toContain('stateSha256: sha(JSON.stringify(semanticState))')
    expect(manager).toContain('preflightStateSha256: preflight.stateSha256')
    expect(manager).toContain('authorizedPreflightStateSha256: authorizedPreflight')
    expect(manager).toContain('before.preflightStateSha256 !== authorizedPreflight')
    const semanticStart = manager.indexOf('function semanticPreflightState')
    const loadStart = manager.indexOf('\nasync function loadPreflight', semanticStart)
    const semantic = manager.slice(semanticStart, loadStart)
    expect(semantic).not.toContain('observedAt')
    expect(semantic).not.toContain('databaseBytes')
  })

  it('requires every retired restore execution path to stay non-executable', () => {
    for (const signature of [
      'public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)',
      'public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)',
      'xrpl_resource_restore_v1.build_restored_accounting_state(text)',
      'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()',
      'xrpl_resource_guard_v2.qualify_transfer_on_completion()',
    ]) {
      expect(manager).toContain(signature)
    }
    expect(manager).toContain("value.serviceRoleExecute !== false || value.authenticatedExecute !== false || value.anonExecute !== false")
    expect(manager).toContain("if ((state.transferTriggerBindings ?? []).length !== 0)")
    expect(manager).toContain("if (Number(state.activeLegacyCronJobs) !== 0)")
    expect(manager).toContain("if (Number(state.openAttempts) !== 0)")
  })

  it('binds the pre-state and proves only restore rows disappear', () => {
    expect(manager).toContain('structuralStateSha256: sha(JSON.stringify(structure))')
    expect(manager).toContain('restoreTables: state.restoreTables')
    expect(manager).toContain('restoreDigests: state.restoreDigests')
    expect(manager).toContain('transferQualifications: state.transferQualifications')
    expect(manager).toContain('protectedCounts: state.protectedCounts')
    expect(manager).toContain("classification(state) !== 'unapplied_expected'")
    expect(manager).toContain("classification(state) !== 'applied_consistent'")
    expect(manager).toContain('values.every((value) => value === 0)')
  })

  it('preserves table identity, durable transfer evidence, scheduler, migration head, and protected rows', () => {
    expect(manager).toContain('beforeTables = tableMap({ restoreTables: before.restoreTables })')
    expect(manager).toContain('beforeOid !== afterOid')
    expect(manager).toContain("fail(`restore relation oid changed: ${table}`)")
    expect(manager).toContain("if (!same(before.protectedCounts, after.protectedCounts))")
    expect(manager).toContain("if (before.maxMigrationVersion !== after.maxMigrationVersion)")
    expect(manager).toContain("if (before.schedulerSha256 !== sha(JSON.stringify(after.scheduler)))")
    expect(manager).toContain("if (!same(before.functions, after.functions))")
    expect(manager).toContain("if (!same(before.transferQualifications, after.transferQualifications))")
  })

  it('reports the bounded mutation without claiming schema/function removal or operational changes', () => {
    for (const expected of [
      'restoreDataReclaimPerformed: true',
      'truncatePerformed: true',
      'restoreRowsRemoved: true',
      'schemaObjectMutationPerformed: false',
      'restoreSchemaDropPerformed: false',
      'functionDropPerformed: false',
      'cascadePerformed: false',
      'vacuumPerformed: false',
      'schedulerMutationPerformed: false',
      'deploymentPerformed: false',
      'r5RearmPerformed: false',
      'mainnetDisabled: true',
      'postVerificationReadOnly: true',
    ]) {
      expect(manager).toContain(expected)
    }
  })
})
