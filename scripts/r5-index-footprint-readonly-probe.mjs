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
with index_rows as (
  select
    ns.nspname as schema_name,
    tbl.relname as table_name,
    idx.relname as index_name,
    pg_relation_size(idx.oid)::bigint as index_bytes,
    i.indisprimary as primary_index,
    i.indisunique as unique_index,
    i.indisvalid as valid_index,
    i.indisready as ready_index,
    pg_get_indexdef(idx.oid) as definition,
    pg_get_expr(i.indpred, i.indrelid) as predicate,
    coalesce(s.idx_scan, 0)::bigint as idx_scan,
    coalesce(s.idx_tup_read, 0)::bigint as idx_tup_read,
    coalesce(s.idx_tup_fetch, 0)::bigint as idx_tup_fetch,
    exists(select 1 from pg_constraint c where c.conindid = idx.oid) as constraint_backed,
    coalesce((
      select jsonb_agg(c.conname order by c.conname)
      from pg_constraint c where c.conindid = idx.oid
    ), '[]'::jsonb) as constraint_names
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  join pg_class tbl on tbl.oid = i.indrelid
  join pg_namespace ns on ns.oid = tbl.relnamespace
  left join pg_stat_all_indexes s on s.indexrelid = idx.oid
  where tbl.relkind in ('r','m')
    and ns.nspname not in ('pg_catalog','information_schema')
    and ns.nspname not like 'pg_toast%'
), table_rows as (
  select
    ns.nspname as schema_name,
    c.relname as table_name,
    pg_relation_size(c.oid)::bigint as heap_bytes,
    pg_indexes_size(c.oid)::bigint as index_bytes,
    pg_total_relation_size(c.oid)::bigint as total_bytes,
    coalesce(st.n_live_tup,0)::bigint as estimated_live_rows,
    coalesce(st.n_dead_tup,0)::bigint as estimated_dead_rows,
    st.last_vacuum,
    st.last_autovacuum,
    st.vacuum_count::bigint,
    st.autovacuum_count::bigint,
    coalesce(c.reloptions, array[]::text[]) as reloptions
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  left join pg_stat_all_tables st on st.relid = c.oid
  where c.relkind in ('r','m')
    and ns.nspname not in ('pg_catalog','information_schema')
    and ns.nspname not like 'pg_toast%'
), database_stats as (
  select stats_reset from pg_stat_database where datname = current_database()
), selected_indexes as (
  select * from index_rows
  where (schema_name, table_name) in (
    ('public','xrpl_phase_reference_rows'),
    ('public','xrpl_phase_messages'),
    ('public','xrpl_phase_successors'),
    ('public','xrpl_phase_work'),
    ('public','xrpl_phase_payload_chunks'),
    ('public','xrpl_phase_commit_chunks'),
    ('public','xrpl_collector_runs'),
    ('cron','job_run_details')
  )
), large_indexes as (
  select * from index_rows where index_bytes >= 1048576
), selected_tables as (
  select * from table_rows
  where (schema_name, table_name) in (
    ('public','xrpl_phase_reference_rows'),
    ('public','xrpl_phase_messages'),
    ('public','xrpl_phase_successors'),
    ('public','xrpl_phase_work'),
    ('public','xrpl_phase_payload_chunks'),
    ('public','xrpl_phase_commit_chunks'),
    ('public','xrpl_collector_runs'),
    ('cron','job_run_details')
  )
)
select jsonb_build_object(
  'schemaVersion', 2,
  'observedAt', clock_timestamp(),
  'databaseBytes', pg_database_size(current_database()),
  'databaseHaltBytes', 400000000,
  'databaseHeadroomBytes', 400000000 - pg_database_size(current_database()),
  'statsReset', (select stats_reset from database_stats),
  'selectedIndexes', coalesce((select jsonb_agg(to_jsonb(x) order by x.index_bytes desc, x.schema_name, x.index_name) from selected_indexes x), '[]'::jsonb),
  'largeIndexes', coalesce((select jsonb_agg(to_jsonb(x) order by x.index_bytes desc, x.schema_name, x.index_name) from large_indexes x), '[]'::jsonb),
  'selectedTables', coalesce((select jsonb_agg(to_jsonb(t) order by t.total_bytes desc, t.schema_name, t.table_name) from selected_tables t), '[]'::jsonb),
  'safetyBoundary', jsonb_build_object(
    'probeReadOnly', true,
    'noIndexMutationAuthorized', true,
    'noDeleteAuthorized', true,
    'noVacuumAuthorized', true,
    'noSchedulerMutationAuthorized', true,
    'noDeploymentAuthorized', true,
    'mainnetDisabled', true
  )
)::text as state;
`

const WORK_AUDIT_SQL = String.raw`
with work_status_counts as (
  select status, count(*)::bigint as rows
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
  group by status
), work_consumers as (
  select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','xrpl_r5_v1')
    and p.prokind = 'f'
    and p.prosrc ilike '%xrpl_phase_work%'
    and p.prosrc ilike '%status%'
), work_views as (
  select
    schemaname as schema_name,
    viewname as view_name,
    definition
  from pg_views
  where schemaname in ('public','xrpl_r5_v1')
    and definition ilike '%xrpl_phase_work%'
), statement_extension as (
  select n.nspname as schema_name
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_stat_statements'
)
select jsonb_build_object(
  'workStatusCounts', coalesce((select jsonb_agg(to_jsonb(x) order by x.status) from work_status_counts x), '[]'::jsonb),
  'workStatusConsumers', coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name, x.function_name, x.identity_arguments) from work_consumers x), '[]'::jsonb),
  'workViews', coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name, x.view_name) from work_views x), '[]'::jsonb),
  'pgStatStatementsSchema', (select schema_name from statement_extension limit 1)
)::text as state;
`

const PLANNER_QUERIES = Object.freeze({
  planned: "explain (format json, costs off) select work_id, status, updated_at from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'planned' order by updated_at, work_id limit 20",
  staged: "explain (format json, costs off) select work_id, status, updated_at from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'staged' order by updated_at, work_id limit 20",
  committing: "explain (format json, costs off) select work_id, status, updated_at from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'committing' order by updated_at, work_id limit 20",
  finalizing: "explain (format json, costs off) select work_id, status, updated_at from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'finalizing' order by updated_at, work_id limit 20",
  error: "explain (format json, costs off) select work_id, status, updated_at from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'error' order by updated_at, work_id limit 20",
  committedReader: "explain (format json, costs off) select work_id, scanned_end_ledger_index from public.xrpl_phase_work where profile_id = 'supabase-devnet' and network = 'devnet' and epoch_id = (select epoch_id from public.xrpl_phase_streams where profile_id = 'supabase-devnet') and base_identity = (select base_identity from public.xrpl_phase_streams where profile_id = 'supabase-devnet') and status = 'committed' order by scanned_end_ledger_index desc, work_id desc limit 20",
  committedCount: "explain (format json, costs off) select count(*) from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'committed'",
})

for (const [name, query] of Object.entries({ SQL, WORK_AUDIT_SQL, ...PLANNER_QUERIES })) {
  if (MUTATION_CAPABILITY.test(query)) fail(`read-only index probe SQL contains forbidden mutation capability: ${name}`)
}

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

function findState(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) fail(`unexpected management query result: ${label}`)
  const raw = rows[0]?.state
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  fail(`${label} state missing`)
}

function firstColumn(rows, label) {
  if (!Array.isArray(rows) || rows.length < 1) fail(`empty query result: ${label}`)
  const row = rows[0]
  const keys = Object.keys(row ?? {})
  if (keys.length !== 1) fail(`unexpected query result shape: ${label}`)
  return row[keys[0]]
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
const outputDir = options['output-dir'] ?? 'r5-index-footprint-readonly-probe'
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const state = findState(await managementQuery(SQL), 'index footprint')
if (state.safetyBoundary?.probeReadOnly !== true ||
    state.safetyBoundary?.noIndexMutationAuthorized !== true ||
    state.safetyBoundary?.noDeleteAuthorized !== true ||
    state.safetyBoundary?.noVacuumAuthorized !== true ||
    state.safetyBoundary?.noSchedulerMutationAuthorized !== true ||
    state.safetyBoundary?.noDeploymentAuthorized !== true ||
    state.safetyBoundary?.mainnetDisabled !== true) {
  fail('index footprint safety boundary missing')
}

const workAudit = findState(await managementQuery(WORK_AUDIT_SQL), 'work status audit')
const plannerPlans = {}
for (const [name, query] of Object.entries(PLANNER_QUERIES)) {
  plannerPlans[name] = firstColumn(await managementQuery(query), `planner ${name}`)
}

let workStatements = []
const statementSchema = workAudit.pgStatStatementsSchema
if (statementSchema != null) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(statementSchema)) fail('invalid pg_stat_statements schema')
  const statementsSql = `select query, calls::bigint as calls, rows::bigint as rows, mean_exec_time from ${statementSchema}.pg_stat_statements where query ilike '%xrpl_phase_work%' order by calls desc limit 100`
  if (MUTATION_CAPABILITY.test(statementsSql)) fail('pg_stat_statements probe contains mutation capability')
  workStatements = await managementQuery(statementsSql)
}

const evidence = {
  sourceCommit,
  querySha256: createHash('sha256').update([SQL, WORK_AUDIT_SQL, ...Object.values(PLANNER_QUERIES)].join('\n-- next --\n')).digest('hex'),
  state,
  workAudit,
  plannerPlans,
  workStatements,
}
const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const evidenceSha256 = createHash('sha256').update(serialized).digest('hex')
await mkdir(outputDir, { recursive: true })
await writeFile(`${outputDir}/evidence.json`, serialized)
await writeFile(`${outputDir}/evidence.sha256`, `${evidenceSha256}\n`)

const nonConstraintLarge = (state.largeIndexes ?? [])
  .filter((x) => !x.primary_index && !x.unique_index && !x.constraint_backed)
  .slice(0, 12)
const summary = [
  '## R5 index footprint read-only probe',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${state.databaseBytes}\``,
  `- 400MB headroom: \`${state.databaseHeadroomBytes}\``,
  `- pg_stat_database stats reset: \`${state.statsReset ?? 'null'}\``,
  `- selected indexes measured: \`${state.selectedIndexes?.length ?? 0}\``,
  `- indexes >=1MiB measured: \`${state.largeIndexes?.length ?? 0}\``,
  `- work-status functions inspected: \`${workAudit.workStatusConsumers?.length ?? 0}\``,
  `- work-status views inspected: \`${workAudit.workViews?.length ?? 0}\``,
  `- pg_stat_statements work queries: \`${workStatements.length}\``,
  '- production mutation: `false`',
  '',
  'Work status counts:',
  ...(workAudit.workStatusCounts ?? []).map((x) => `- \`${x.status}\`: ${x.rows}`),
  '',
  'Largest non-primary/non-unique/non-constraint indexes:',
  ...nonConstraintLarge.map((x) => `- \`${x.schema_name}.${x.index_name}\`: ${x.index_bytes} B, idx_scan=${x.idx_scan}, table=${x.table_name}`),
  '',
  `Evidence SHA-256: \`${evidenceSha256}\``,
].join('\n')
await writeFile(`${outputDir}/summary.md`, `${summary}\n`)
console.log(summary)
