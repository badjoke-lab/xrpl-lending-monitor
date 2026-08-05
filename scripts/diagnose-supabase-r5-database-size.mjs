import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('invalid project ref')
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('access token unavailable')
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
const sourceCommit = process.env.GITHUB_SHA ?? ''
if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) throw new Error('invalid run id')
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('invalid commit')

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const sourceSizeRunId = 30976693948
const databaseHaltBytes = 400_000_000
const observedDatabaseBytes = 417_082_515
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const output = 'supabase-r5-database-size-diagnostic'

function parse(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2_000) } }
}
function rows(body) {
  for (const value of [body, body?.result, body?.data, body?.rows, body?.result?.rows]) {
    if (Array.isArray(value)) return value
  }
  throw new Error('query response contains no rows')
}
function object(value, name) {
  const parsed = typeof value === 'string' ? parse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} invalid`)
  }
  return parsed
}
function array(value, name) {
  const parsed = typeof value === 'string' ? parse(value) : value
  if (!Array.isArray(parsed)) throw new Error(`${name} invalid`)
  return parsed
}
function integer(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} invalid`)
  return parsed
}
function code(value) {
  return `\`${String(value ?? 'null').replaceAll('`', "'")}\``
}
function cell(value) {
  return String(value ?? 'null').replaceAll('|', '\\|').replaceAll('\n', ' ')
}
async function query(sql, parameters) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql, parameters, read_only: true }),
    signal: AbortSignal.timeout(60_000),
  })
  const body = parse(await response.text())
  if (!response.ok) {
    throw new Error(`query failed ${response.status}: ${JSON.stringify(body).slice(0, 2_000)}`)
  }
  return rows(body)
}

const sql = `
with physical_relations as (
  select
    n.nspname as schema_name,
    c.relname as relation_name,
    c.relkind::text as relation_kind,
    pg_relation_size(c.oid)::bigint as physical_bytes,
    case
      when n.nspname in ('public', 'xrpl_r5_v1') then 'application'
      when n.nspname = 'information_schema' or n.nspname like 'pg_%' then 'postgres_system'
      else 'supabase_or_extension'
    end as schema_category
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'i', 'm', 't', 'S')
    and c.relpersistence <> 't'
    and c.relisshared = false
    and n.nspname not like 'pg_temp_%'
    and n.nspname not like 'pg_toast_temp_%'
), schema_physical_totals as (
  select
    schema_name,
    schema_category,
    sum(physical_bytes)::bigint as physical_bytes,
    count(*)::bigint as physical_relation_count
  from physical_relations
  group by schema_name, schema_category
), physical_total as (
  select coalesce(sum(physical_bytes), 0)::bigint as physical_bytes
  from physical_relations
), top_physical_relations as (
  select *
  from physical_relations
  order by physical_bytes desc, schema_name, relation_name
  limit 50
), table_sizes as (
  select
    n.nspname as schema_name,
    c.relname as relation_name,
    c.relkind::text as relation_kind,
    pg_total_relation_size(c.oid)::bigint as total_bytes,
    pg_relation_size(c.oid)::bigint as heap_bytes,
    pg_indexes_size(c.oid)::bigint as index_bytes,
    greatest(
      pg_total_relation_size(c.oid)
      - pg_relation_size(c.oid)
      - pg_indexes_size(c.oid),
      0
    )::bigint as toast_bytes,
    greatest(c.reltuples, 0)::bigint as estimated_rows
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'm', 'p')
    and c.relpersistence <> 't'
    and c.relisshared = false
    and n.nspname not like 'pg_temp_%'
    and n.nspname not like 'pg_toast%'
), table_stats as (
  select
    schemaname as schema_name,
    relname as relation_name,
    n_live_tup::bigint as live_rows,
    n_dead_tup::bigint as dead_rows,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
  from pg_catalog.pg_stat_user_tables
), top_tables as (
  select
    sizes.*,
    stats.live_rows,
    stats.dead_rows,
    stats.last_vacuum,
    stats.last_autovacuum,
    stats.last_analyze,
    stats.last_autoanalyze
  from table_sizes sizes
  left join table_stats stats
    on stats.schema_name = sizes.schema_name
   and stats.relation_name = sizes.relation_name
  order by sizes.total_bytes desc, sizes.schema_name, sizes.relation_name
  limit 50
), work_counts as (
  select profile_id, status, count(*)::bigint as row_count
  from public.xrpl_phase_work
  group by profile_id, status
), message_counts as (
  select profile_id, status, count(*)::bigint as row_count
  from public.xrpl_phase_messages
  group by profile_id, status
), reference_counts as (
  select
    work.profile_id,
    work.status as work_status,
    count(rows.*)::bigint as row_count,
    count(distinct work.work_id)::bigint as work_count
  from public.xrpl_phase_work work
  left join public.xrpl_phase_reference_rows rows on rows.work_id = work.work_id
  group by work.profile_id, work.status
), r5_batch_counts as (
  select status, count(*)::bigint as row_count,
         min(batch_sequence)::bigint as minimum_sequence,
         max(batch_sequence)::bigint as maximum_sequence
  from xrpl_r5_v1.recovery_batches
  where run_id = $1::text
  group by status
)
select jsonb_build_object(
  'purpose', 'r5-all-schema-database-size-read-only-diagnostic',
  'sourceSizeRunId', $2::bigint,
  'databaseHaltBytes', $3::bigint,
  'previousObservedDatabaseBytes', $4::bigint,
  'databaseBytes', pg_database_size(current_database())::bigint,
  'accountedPhysicalBytes', (select physical_bytes from physical_total),
  'unaccountedDatabaseBytes',
    greatest(
      pg_database_size(current_database())::bigint
      - (select physical_bytes from physical_total),
      0
    )::bigint,
  'schemaPhysicalTotals', coalesce((
    select jsonb_agg(to_jsonb(s) order by s.physical_bytes desc, s.schema_name)
    from schema_physical_totals s
  ), '[]'::jsonb),
  'topPhysicalRelations', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.physical_bytes desc, r.schema_name, r.relation_name)
    from top_physical_relations r
  ), '[]'::jsonb),
  'topTables', coalesce((
    select jsonb_agg(to_jsonb(t) order by t.total_bytes desc, t.schema_name, t.relation_name)
    from top_tables t
  ), '[]'::jsonb),
  'workCounts', coalesce((
    select jsonb_agg(to_jsonb(w) order by w.profile_id, w.status)
    from work_counts w
  ), '[]'::jsonb),
  'messageCounts', coalesce((
    select jsonb_agg(to_jsonb(m) order by m.profile_id, m.status)
    from message_counts m
  ), '[]'::jsonb),
  'referenceCounts', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.profile_id, r.work_status)
    from reference_counts r
  ), '[]'::jsonb),
  'r5BatchCounts', coalesce((
    select jsonb_agg(to_jsonb(b) order by b.status)
    from r5_batch_counts b
  ), '[]'::jsonb),
  'recoverySummary', public.xrpl_read_r5_active_recovery($1::text)
) as diagnostic
`

const result = await query(sql, [
  recoveryRunId,
  sourceSizeRunId,
  databaseHaltBytes,
  observedDatabaseBytes,
])
if (result.length !== 1) throw new Error(`unexpected rows:${result.length}`)
const diagnostic = object(result[0].diagnostic, 'diagnostic')
const recovery = object(diagnostic.recoverySummary, 'recovery')
const schemaTotals = array(diagnostic.schemaPhysicalTotals, 'schema physical totals')
const topPhysicalRelations = array(diagnostic.topPhysicalRelations, 'top physical relations')
const topTables = array(diagnostic.topTables, 'top tables')
const workCounts = array(diagnostic.workCounts, 'work counts')
const messageCounts = array(diagnostic.messageCounts, 'message counts')
const referenceCounts = array(diagnostic.referenceCounts, 'reference counts')
const r5BatchCounts = array(diagnostic.r5BatchCounts, 'R5 batch counts')
const databaseBytes = integer(diagnostic.databaseBytes, 'database bytes')
const accountedPhysicalBytes = integer(
  diagnostic.accountedPhysicalBytes,
  'accounted physical bytes',
)
const unaccountedDatabaseBytes = integer(
  diagnostic.unaccountedDatabaseBytes,
  'unaccounted database bytes',
)
const checks = {
  readOnly: true,
  exactSourceRun: Number(diagnostic.sourceSizeRunId) === sourceSizeRunId,
  exactHaltBoundary: Number(diagnostic.databaseHaltBytes) === databaseHaltBytes,
  priorDiagnosticEvidenceBound:
    Number(diagnostic.previousObservedDatabaseBytes) === observedDatabaseBytes,
  databaseAtOrAboveHalt: databaseBytes >= databaseHaltBytes,
  allSchemaBreakdownPresent: schemaTotals.length > 2,
  applicationSchemasPresent:
    schemaTotals.some((entry) => entry.schema_name === 'public')
    && schemaTotals.some((entry) => entry.schema_name === 'xrpl_r5_v1'),
  temporarySchemasExcluded: schemaTotals.every((entry) => (
    !String(entry.schema_name).startsWith('pg_temp_')
    && !String(entry.schema_name).startsWith('pg_toast_temp_')
  )),
  physicalBytesDoNotExceedDatabase: accountedPhysicalBytes <= databaseBytes,
  unaccountedArithmeticExact:
    unaccountedDatabaseBytes === databaseBytes - accountedPhysicalBytes,
  tableBreakdownPresent: topTables.length > 0 && topPhysicalRelations.length > 0,
  profileBreakdownPresent:
    workCounts.length > 0 && messageCounts.length > 0 && referenceCounts.length > 0,
  r5BatchBreakdownPresent: r5BatchCounts.length > 0,
  exactRecovery: recovery.runId === recoveryRunId,
  activeRecoveryRetained: ['running', 'caught_up'].includes(recovery.status),
  publicReaderUnchanged: recovery.checks?.publicReaderUnchanged === true,
  mainnetDisabled: recovery.checks?.mainnetDisabled === true,
  stabilizationUnauthorized: recovery.checks?.stabilizationAuthorized === false,
  soakUnauthorized: recovery.checks?.soakAuthorized === false,
}
const evidence = {
  ...diagnostic,
  sourceRunId,
  sourceCommit,
  verifiedAt: new Date().toISOString(),
  checks,
}
await mkdir(output, { recursive: true })
await writeFile(`${output}/diagnostic.json`, `${JSON.stringify(evidence, null, 2)}\n`)

const schemaLines = schemaTotals.slice(0, 30).map((entry) => (
  `| ${cell(entry.schema_name)} | ${cell(entry.schema_category)} | ${cell(entry.physical_bytes)} | ${cell(entry.physical_relation_count)} |`
))
const tableLines = topTables.slice(0, 30).map((entry) => (
  `| ${cell(entry.schema_name)} | ${cell(entry.relation_name)} | ${cell(entry.total_bytes)} | ${cell(entry.heap_bytes)} | ${cell(entry.index_bytes)} | ${cell(entry.toast_bytes)} | ${cell(entry.live_rows ?? entry.estimated_rows)} | ${cell(entry.dead_rows)} |`
))
const physicalLines = topPhysicalRelations.slice(0, 30).map((entry) => (
  `| ${cell(entry.schema_name)} | ${cell(entry.relation_name)} | ${cell(entry.relation_kind)} | ${cell(entry.physical_bytes)} |`
))
const mismatchNames = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name)
const markdown = `## R5 all-schema database-size read-only diagnostic

- run: ${code(sourceRunId)}
- commit: ${code(sourceCommit)}
- source size run: ${code(sourceSizeRunId)}
- database bytes: ${code(databaseBytes)}
- database halt bytes: ${code(databaseHaltBytes)}
- bytes over halt: ${code(Math.max(databaseBytes - databaseHaltBytes, 0))}
- accounted physical relation bytes: ${code(accountedPhysicalBytes)}
- unaccounted database bytes: ${code(unaccountedDatabaseBytes)}
- previous diagnostic bytes: ${code(observedDatabaseBytes)}
- recovery status: ${code(recovery.status)}
- completed batches: ${code(recovery.completedBatches)}
- committed ledgers: ${code(recovery.committedLedgers)}
- mismatched checks: ${code(mismatchNames.length ? mismatchNames.join(',') : 'none')}
- read-only: ${code(true)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(false)}
- soak authorized: ${code(false)}

### Physical bytes by schema

| Schema | Category | Physical bytes | Relations |
|---|---|---:|---:|
${schemaLines.join('\n')}

### Largest logical tables

| Schema | Relation | Total bytes | Heap bytes | Index bytes | TOAST bytes | Live/estimated rows | Dead rows |
|---|---|---:|---:|---:|---:|---:|---:|
${tableLines.join('\n')}

### Largest physical relations

| Schema | Relation | Kind | Physical bytes |
|---|---|---|---:|
${physicalLines.join('\n')}
`
await writeFile(`${output}/diagnostic.md`, markdown)
process.stdout.write(markdown)

if (mismatchNames.length > 0) {
  throw new Error(`all-schema database-size diagnostic checks failed: ${mismatchNames.join(',')}`)
}
