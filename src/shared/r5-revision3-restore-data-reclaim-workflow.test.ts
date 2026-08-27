import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-legacy-rev3-execution-retirement.yml'),
  'utf8',
)

describe('revision-3 restore data reclaim workflow', () => {
  it('reuses the existing retirement workflow instead of adding another Actions workflow', () => {
    expect(workflow).toContain('restore_reclaim_prepare:')
    expect(workflow).toContain('restore_reclaim_execute:')
    expect(workflow).toContain("github.event.comment.body == '/r5-revision3-restore-data-reclaim-prepare'")
    expect(workflow).toContain("startsWith(github.event.comment.body, '/r5-revision3-restore-data-reclaim-authorize ')")
  })

  it('requires a fresh read-only removal proof before proposing any mutation', () => {
    expect(workflow).toContain('node scripts/r5-resource-restore-reclaim-readonly-preflight.mjs')
    expect(workflow).toContain('.state.reclaimEvidence.restoreSchemaRemovalProvenSafe')
    expect(workflow).toContain('.state.reclaimEvidence.futureRevision3QualificationDemandProvenClosed')
    expect(workflow).toContain('--preflight-evidence "$preflight"')
    expect(workflow).toContain(`test "$(jq -r '.classification' "$file")" = unapplied_expected`)
  })

  it('binds exact source, manager, plan, structural state, semantic preflight, project, and migration head', () => {
    for (const field of [
      'commit=${SOURCE_COMMIT}',
      'manager=${MANAGER_SHA}',
      'plan=${PLAN_SHA}',
      'state=${STATE_SHA}',
      'preflight=${PREFLIGHT_SHA}',
      'project=${PROJECT_DIGEST}',
      'head=${MIGRATION_HEAD}',
      'prepare_run=${GITHUB_RUN_ID}',
      'nonce=${nonce}',
    ]) {
      expect(workflow).toContain(field)
    }
    expect(workflow).toContain(`test "$(jq -r '.preflightStateSha256' "$file")" = "$AUTH_PREFLIGHT"`)
  })

  it('requires one exact prior proposal and one unique owner authorization', () => {
    expect(workflow).toContain('expected one exact restore reclaim proposal')
    expect(workflow).toContain('restore reclaim proposal must precede authorization')
    expect(workflow).toContain('restore reclaim authorization must be unique')
    expect(workflow).toContain('.actor.login == "badjoke-lab"')
  })

  it('reproves the semantic preflight immediately before apply', () => {
    const executeStart = workflow.indexOf('restore_reclaim_execute:')
    expect(executeStart).toBeGreaterThanOrEqual(0)
    const execute = workflow.slice(executeStart)
    expect(execute).toContain('Reprove and bind exact restore reclaim state read-only')
    expect(execute).toContain('node scripts/r5-resource-restore-reclaim-readonly-preflight.mjs')
    expect(execute).toContain(`test "$(jq -r '.preflightStateSha256' "$file")" = "$AUTH_PREFLIGHT"`)
    expect(execute).toContain('--authorized-preflight "$AUTH_PREFLIGHT"')
  })

  it('verifies only the three restore data sets are emptied and durable evidence stays intact', () => {
    expect(workflow).toContain('.restoreRowsAfter.targets == 0')
    expect(workflow).toContain('.restoreRowsAfter.attemptRows == 0')
    expect(workflow).toContain('.restoreRowsAfter.accountingRows == 0')
    expect(workflow).toContain('.transferQualificationsBefore == .transferQualificationsAfter')
    expect(workflow).toContain('.protectedCountsBefore == .protectedCountsAfter')
    for (const flag of [
      '.schemaObjectMutationPerformed',
      '.restoreSchemaDropPerformed',
      '.functionDropPerformed',
      '.cascadePerformed',
      '.vacuumPerformed',
      '.schedulerMutationPerformed',
      '.deploymentPerformed',
      '.r5RearmPerformed',
    ]) {
      expect(workflow).toContain(flag)
    }
  })

  it('runs an independent existing restore audit after the bounded mutation', () => {
    expect(workflow).toContain('Independently audit restore storage after reclaim read-only')
    expect(workflow).toContain('node scripts/r5-resource-restore-readonly-audit.mjs')
    expect(workflow).toContain('.state.exactRows.targets == 0')
    expect(workflow).toContain('.state.exactRows.attemptRows == 0')
    expect(workflow).toContain('.state.exactRows.accountingRows == 0')
    expect(workflow).toContain('.state.safetyBoundary.probeReadOnly')
    expect(workflow).toContain('.state.safetyBoundary.mainnetDisabled')
  })

  it('documents the non-CASCADE, no-DROP, no-VACUUM boundary in the proposal and result', () => {
    expect(workflow).toContain('The restore schema and every function remain present.')
    expect(workflow).toContain('CASCADE, RESTART IDENTITY, DELETE, DROP, VACUUM')
    expect(workflow).toContain('one exact non-CASCADE TRUNCATE of the three retired')
    expect(workflow).toContain('No DROP, DELETE, VACUUM')
  })
})
