import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const probe = readFileSync(
  resolve(process.cwd(), 'scripts/r5-revision3-restore-schema-retirement-readonly-preflight.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-index-footprint-readonly-probe.yml'),
  'utf8',
)

describe('revision-3 restore schema retirement read-only preflight', () => {
  it('uses the management API in explicit read-only mode', () => {
    expect(probe).toContain("body: JSON.stringify({ query, read_only: true })")
    expect(probe).toContain("const MUTATION_CAPABILITY = /\\b(delete|update|insert|alter|drop|truncate|vacuum|create|grant|revoke|refresh|cluster|reindex)\\b/iu")
    expect(probe).toContain("if (MUTATION_CAPABILITY.test(SQL)) fail('restore schema retirement preflight SQL contains forbidden mutation capability')")
  })

  it('inventories every exact candidate retirement function without authorizing retirement', () => {
    for (const signature of [
      'public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)',
      'public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)',
      'xrpl_resource_restore_v1.build_restored_accounting_state(text)',
      'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()',
      'xrpl_resource_guard_v2.qualify_transfer_on_completion()',
    ]) {
      expect(probe).toContain(signature)
    }
    for (const boundary of [
      "'functionDropAuthorized',false",
      "'schemaDropAuthorized',false",
      "'tableDropAuthorized',false",
      "'cascadeAuthorized',false",
      "'rowMutationAuthorized',false",
      "'schedulerMutationAuthorized',false",
      "'deploymentAuthorized',false",
      "'r5RearmAuthorized',false",
      "'mainnetDisabled',true",
    ]) {
      expect(probe).toContain(boundary)
    }
  })

  it('requires the already-reclaimed three restore tables and an idle legacy runtime', () => {
    expect(probe).toContain("Number(value) !== 0")
    expect(probe).toContain("fail('restore schema still contains historical rows')")
    expect(probe).toContain("if (Number(state.activeLegacyCronJobs) !== 0)")
    expect(probe).toContain("if (Number(state.runningGuardedSessions) !== 0)")
    expect(probe).toContain("Number(state.leasedTicks) !== 0 || Number(state.liveLeasedTicks) !== 0")
    expect(probe).toContain("if (Number(state.openAttempts) !== 0)")
  })

  it('captures dependencies, source references, triggers, views, protected counts, and transfer digest', () => {
    for (const expected of [
      "'restoreRelations'",
      "'restoreFunctions'",
      "'sourceReferences'",
      "'dependentObjects'",
      "'triggerBindings'",
      "'referencingViews'",
      "'transferQualifications'",
      "'protectedCounts'",
      "'scheduler'",
    ]) {
      expect(probe).toContain(expected)
    }
    expect(probe).toContain("if ((state.triggerBindings ?? []).length !== 0)")
    expect(probe).toContain("if ((state.referencingViews ?? []).length !== 0)")
  })

  it('reuses the existing exact-owner read-only workflow and adds no execute surface', () => {
    expect(workflow).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(workflow).toContain("github.event.comment.body == '/r5-index-footprint-readonly-probe'")
    expect(workflow).toContain('Inventory revision-3 restore schema retirement only')
    expect(workflow).toContain('r5-revision3-restore-schema-retirement-readonly-preflight.mjs')
    expect(workflow).toContain('restore-schema-retirement/summary.md')
    expect(workflow).not.toMatch(/\n\s*execute:\s*\n/u)
    expect(workflow).not.toContain('-authorize ')
    expect(workflow).not.toContain('read_only: false')
  })
})
