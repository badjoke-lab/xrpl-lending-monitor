import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

function fail(message) {
  throw new Error(message)
}

function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) fail(`invalid argument: ${arg}`)
    const key = arg.slice(2)
    const value = args[i + 1]
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`)
    out[key] = value
    i += 1
  }
  return out
}

const MUTATION_CAPABILITY = /\b(delete|update|insert|alter|drop|truncate|vacuum|create|grant|revoke|refresh|cluster|reindex)\b/iu

const SQL = String.raw`
with restore_tables as (
  select
    c.relname as table_name,
    c.oid::bigint as relation_oid,
    pg_relation_size(c.oid)::bigint as heap_bytes,
    pg_indexes_size(c.oid)::bigint as index_bytes,
    pg_total_relation_size(c.oid)::bigint as total_bytes,
    coalesce(s.n_live_tup, 0)::bigint as estimated_live_rows,
    coalesce(s.n_dead_tup, 0)::bigint as estimated_dead_rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_all_tables s on s.relid = c.oid
  where n.nspname = 'xrpl_resource_restore_v1'
    and c.relkind = 'r'
), restore_indexes as (
  select
    tbl.relname as table_name,
    idx.relname as index_name,
    pg_relation_size(idx.oid)::bigint as index_bytes,
    i.indisprimary as primary_index,
    i.indisunique as unique_index,
    pg_get_indexdef(idx.oid) as definition
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  join pg_class tbl on tbl.oid = i.indrelid
  join pg_namespace n on n.oid = tbl.relnamespace
  where n.nspname = 'xrpl_resource_restore_v1'
), target_state as (
  select
    t.target_id,
    t.source_session_id,
    t.profile_revision,
    t.source_observed_at,
    t.restored_at,
    t.state_digest,
    t.attempt_count,
    t.accounting_count,
    (q.session_id is not null) as durable_qualification_present,
    coalesce(q.result->>'targetId', '') = t.target_id as qualification_target_matches,
    coalesce(q.result->>'stateDigest', '') = t.state_digest as qualification_digest_matches,
    coalesce((q.result #>> '{checks,rolling31dStateExported}')::boolean, false) as rolling_state_exported,
    coalesce((q.result #>> '{checks,typedRestoreCompleted}')::boolean, false) as typed_restore_completed,
    coalesce((q.result #>> '{checks,canonicalDigestParity}')::boolean, false) as canonical_digest_parity,
    coalesce((q.result #>> '{checks,duplicateRestoreConverged}')::boolean, false) as duplicate_restore_converged,
    coalesce((q.result #>> '{checks,digestTamperRejected}')::boolean, false) as digest_tamper_rejected,
    coalesce((q.result #>> '{checks,effectiveEgressPreserved}')::boolean, false) as effective_egress_preserved,
    coalesce((q.result #>> '{checks,reservedInvocationsPreserved}')::boolean, false) as reserved_invocations_preserved,
    coalesce((q.result #>> '{checks,activeProfileReadOnly}')::boolean, false) as active_profile_read_only
  from xrpl_resource_restore_v1.targets t
  left join xrpl_resource_guard_v2.transfer_qualifications q
    on q.session_id = t.source_session_id
), target_classification as (
  select *,
    durable_qualification_present
      and qualification_target_matches
      and qualification_digest_matches
      and rolling_state_exported
      and typed_restore_completed
      and canonical_digest_parity
      and duplicate_restore_converged
      and digest_tamper_rejected
      and effective_egress_preserved
      and reserved_invocations_preserved
      and active_profile_read_only as durable_qualification_matches
  from target_state
), consumers as (
  select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    case when n.nspname = 'xrpl_r5_v1' then true else false end as revision4_runtime_schema,
    p.prosrc ilike '%xrpl_resource_restore_v1%' as names_restore_schema,
    p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' as names_restore_rpc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and (
      p.prosrc ilike '%xrpl_resource_restore_v1%'
      or p.prosrc ilike '%xrpl_restore_revision3_accounting_state%'
    )
), views as (
  select schemaname as schema_name, viewname as view_name
  from pg_views
  where definition ilike '%xrpl_resource_restore_v1%'
     or definition ilike '%xrpl_restore_revision3_accounting_state%'
)
select jsonb_build_object(
  'schemaVersion', 1,
  'observedAt', clock_timestamp(),
  'databaseBytes', pg_database_size(current_database())::bigint,
  'databaseHaltBytes', 400000000::bigint,
  'databaseHeadroomBytes', 400000000::bigint - pg_database_size(current_database())::bigint,
  'restoreSchemaBytes', coalesce((select sum(total_bytes)::bigint from restore_tables), 0),
  'restoreTables', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_bytes desc, x.table_name) from restore_tables x), '[]'::jsonb),
  'restoreIndexes', coalesce((select jsonb_agg(to_jsonb(x) order by x.index_bytes desc, x.index_name) from restore_indexes x), '[]'::jsonb),
  'exactRows', jsonb_build_object(
    'targets', (select count(*)::bigint from xrpl_resource_restore_v1.targets),
    'attemptRows', (select count(*)::bigint from xrpl_resource_restore_v1.attempt_rows),
    'accountingRows', (select count(*)::bigint from xrpl_resource_restore_v1.accounting_rows)
  ),
  'targets', jsonb_build_object(
    'distinctSourceSessions', (select count(distinct source_session_id)::bigint from target_classification),
    'oldestRestoredAt', (select min(restored_at) from target_classification),
    'newestRestoredAt', (select max(restored_at) from target_classification),
    'profileRevisions', coalesce((select jsonb_agg(distinct profile_revision order by profile_revision) from target_classification), '[]'::jsonb),
    'durablyQualifiedMatching', (select count(*)::bigint from target_classification where durable_qualification_matches),
    'notDurablyQualifiedMatching', (select count(*)::bigint from target_classification where not durable_qualification_matches),
    'latest', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.restored_at desc, x.target_id)
      from (
        select target_id, source_session_id, profile_revision, source_observed_at, restored_at,
               state_digest, attempt_count, accounting_count, durable_qualification_matches
        from target_classification
        order by restored_at desc, target_id
        limit 20
      ) x
    ), '[]'::jsonb)
  ),
  'consumers', coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name, x.function_name, x.identity_arguments) from consumers x), '[]'::jsonb),
  'views', coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name, x.view_name) from views x), '[]'::jsonb),
  'revision4RuntimeConsumerCount', (select count(*)::bigint from consumers where revision4_runtime_schema),
  'safetyBoundary', jsonb_build_object(
    'probeReadOnly', true,
    'measurementOnly', true,
    'noRetentionDecisionAuthorized', true,
    'noRowMutationAuthorized', true,
    'noIndexMutationAuthorized', true,
    'noVacuumAuthorized', true,
    'noSchedulerMutationAuthorized', true,
    'noDeploymentAuthorized', true,
    'noR5RestartAuthorized', true,
    'mainnetDisabled', true
  )
)::text as state;
`

if (MUTATION_CAPABILITY.test(SQL)) fail('restore audit SQL contains forbidden mutation capability')

async function managementQuery(query) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, read_only: true }),
  })
  if (!response.ok) fail(`management query failed: ${response.status}`)
  return response.json()
}

function findState(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail('unexpected management query result')
  const raw = rows[0]?.state
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  fail('restore audit state missing')
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
const outputDir = options['output-dir'] ?? 'r5-index-footprint-readonly-probe'
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const state = findState(await managementQuery(SQL))
const safety = state.safetyBoundary ?? {}
for (const key of [
  'probeReadOnly',
  'measurementOnly',
  'noRetentionDecisionAuthorized',
  'noRowMutationAuthorized',
  'noIndexMutationAuthorized',
  'noVacuumAuthorized',
  'noSchedulerMutationAuthorized',
  'noDeploymentAuthorized',
  'noR5RestartAuthorized',
  'mainnetDisabled',
]) {
  if (safety[key] !== true) fail(`restore audit safety boundary missing: ${key}`)
}

const evidence = {
  sourceCommit,
  querySha256: createHash('sha256').update(SQL).digest('hex'),
  state,
}
const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const evidenceSha256 = createHash('sha256').update(serialized).digest('hex')
await mkdir(outputDir, { recursive: true })
await writeFile(`${outputDir}/resource-restore-evidence.json`, serialized)
await writeFile(`${outputDir}/resource-restore-evidence.sha256`, `${evidenceSha256}\n`)

const tableLines = (state.restoreTables ?? []).map(
  (x) => `- \`xrpl_resource_restore_v1.${x.table_name}\`: total=${x.total_bytes} B, heap=${x.heap_bytes} B, indexes=${x.index_bytes} B, est_live=${x.estimated_live_rows}, est_dead=${x.estimated_dead_rows}`,
)
const summary = [
  '## R5 revision-3 restore storage read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${state.databaseBytes}\``,
  `- 400MB headroom: \`${state.databaseHeadroomBytes}\``,
  `- restore schema bytes: \`${state.restoreSchemaBytes}\``,
  `- exact targets: \`${state.exactRows?.targets ?? 0}\``,
  `- exact attempt rows: \`${state.exactRows?.attemptRows ?? 0}\``,
  `- exact accounting rows: \`${state.exactRows?.accountingRows ?? 0}\``,
  `- distinct source sessions: \`${state.targets?.distinctSourceSessions ?? 0}\``,
  `- profile revisions present: \`${JSON.stringify(state.targets?.profileRevisions ?? [])}\``,
  `- targets with matching durable transfer qualification: \`${state.targets?.durablyQualifiedMatching ?? 0}\``,
  `- targets without matching durable transfer qualification: \`${state.targets?.notDurablyQualifiedMatching ?? 0}\``,
  `- revision-4 runtime consumers found: \`${state.revision4RuntimeConsumerCount ?? 0}\``,
  `- restore-schema function consumers found: \`${state.consumers?.length ?? 0}\``,
  `- restore-schema views found: \`${state.views?.length ?? 0}\``,
  '',
  'Restore table footprint:',
  ...tableLines,
  '',
  'This is measurement only. A matching durable qualification is not by itself authority to remove a restore target; any retention/reclaim action requires a separate proof, exact owner authorization, bounded apply, and independent read-only verification.',
  '',
  `Evidence SHA-256: \`${evidenceSha256}\``,
].join('\n')
await writeFile(`${outputDir}/resource-restore-summary.md`, `${summary}\n`)
console.log(summary)
