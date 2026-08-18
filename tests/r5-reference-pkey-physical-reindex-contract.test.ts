import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const workflowUrl = new URL('../.github/workflows/r5-reference-pkey-physical-reindex.yml', import.meta.url)
const managerUrl = new URL('../scripts/manage-r5-reference-pkey-physical-reindex.mjs', import.meta.url)

async function text(url: URL) { return readFile(url, 'utf8') }

describe('R5 reference pkey physical reindex production contract', () => {
  test('keeps the workflow behind exact issue-owner authorization', async () => {
    const workflow = await text(workflowUrl)
    for (const required of [
      "github.event.comment.body == '/r5-reference-pkey-reindex-prepare'",
      "startsWith(github.event.comment.body, '/r5-reference-pkey-reindex-authorize ')",
      'Verify exact prior proposal and unique owner authorization',
      'Revalidate exact authorized state read-only',
      'Apply exact bounded reference pkey physical reindex',
      'Independent post-commit read-only verify',
      'rowMutationAuthorized',
      'vacuumAuthorized',
      'schedulerMutationAuthorized',
      'mainnetDisabled',
      'r5RearmAuthorized',
      'retention-days: 14',
    ]) expect(workflow).toContain(required)
    expect(workflow.match(/issues: write/g)?.length).toBe(1)
    for (const forbidden of ['  push:', '  schedule:', 'workflow_dispatch', 'pull_request_target', 'contents: write', 'supabase functions deploy', 'supabase db push', 'cron.schedule', 'cron.unschedule', 'wrangler deploy', "MAINNET_ENABLED: 'true'"]) expect(workflow).not.toContain(forbidden)
  })

  test('allows exactly one row-preserving reference pkey REINDEX and preserves peer state', async () => {
    const manager = await text(managerUrl)
    for (const required of [
      "const TABLE = 'public.xrpl_phase_reference_rows'",
      "const PKEY = 'public.xrpl_phase_reference_rows_pkey'",
      "const LOOKUP = 'public.xrpl_phase_reference_lookup_idx'",
      "const EXPECTED_PKEY_CONSTRAINT = 'PRIMARY KEY (work_id, semantic_class, canonical_key)'",
      'const MAX_DATABASE_BYTES_BEFORE = 420_000_000',
      'const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 34_000_000',
      'const MAX_CONSERVATIVE_PEAK_BYTES = 455_000_000',
      "set local lock_timeout='5s'",
      "set local statement_timeout='120s'",
      'lock table public.xrpl_phase_reference_rows in share mode',
      'reference pkey authorized data drift under lock',
      'reference constraint state drift under lock',
      'reference pkey reindex safety ceiling exceeded under lock',
      'reindex index public.xrpl_phase_reference_rows_pkey;',
      'post-reindex reference row/constraint state mismatch',
      'post-reindex reference lookup changed',
      'reference pkey bytes were not reclaimed',
      'independent verify structural state mismatch',
      'productionReadOnly: true',
      'rowMutationPerformed: false',
      'vacuumPerformed: false',
      'schedulerMutationPerformed: false',
      'r5RearmPerformed: false',
    ]) expect(manager).toContain(required)

    expect(manager.match(/reindex index public\.xrpl_phase_reference_rows_pkey;/g)?.length).toBe(1)
    expect(manager.toLowerCase()).not.toContain('reindex index public.xrpl_phase_reference_lookup_idx')
    for (const forbidden of ['delete from public', 'truncate table', 'update public', 'insert into public', 'vacuum ', 'cluster ', 'cron.schedule', 'cron.unschedule', 'wrangler deploy']) expect(manager.toLowerCase()).not.toContain(forbidden)

    const lock = manager.indexOf('lock table public.xrpl_phase_reference_rows in share mode')
    const revalidate = manager.indexOf('reference pkey authorized data drift under lock')
    const reindex = manager.indexOf('reindex index public.xrpl_phase_reference_rows_pkey;')
    expect(lock).toBeGreaterThanOrEqual(0)
    expect(revalidate).toBeGreaterThan(lock)
    expect(reindex).toBeGreaterThan(revalidate)

    const dataStart = manager.indexOf('function dataState(state)')
    const mutationStart = manager.indexOf('function mutationSql', dataStart)
    const dataState = manager.slice(dataStart, mutationStart)
    expect(dataState).not.toContain('Scans')
    expect(dataState).not.toContain('databaseBytes')
  })
})
