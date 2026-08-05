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
const sourceHeadroomRunId = 30975277983
const databaseHaltBytes = 400_000_000
const observedDatabaseBytes = 416_763_027
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
with relation_sizes as (
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
  where n.nspname in ('public', 'xrpl_r5_v1')
    and c.relkind in ('r', 'm', 'p')
), relation_stats as (
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
  where schemaname in ('public', 'xrpl_r5_v1')
), enriched_relations as (
  select
    sizes.*,
    stats.live_rows,
    stats.dead_rows,
    stats.last_vacuum,
    stats.last_autovacuum,
    stats.last_analyze,
    stats.last_autoanalyze
  from relation_sizes sizes
  left join relation_stats stats
    on stats.schema_name = sizes.schema_name
   and stats.relation_name = sizes.relation_name
), top_relations as (
  select *
  from enriched_relations
  order by total_bytes desc, schema_name, relation_name
  limit 40
), schema_totals as (
  select
    schema_name,
    sum(total_bytes)::bigint as total_bytes,
    sum(heap_bytes)::bigint as heap_bytes,
    sum(index_bytes)::bigint as index_bytes,
    sum(toast_bytes)::bigint as toast_bytes,
    sum(coalesce(live_rows, estimated_rows, 0))::bigint as estimated_live_rows,
    sum(coalesce(dead_rows, 0))::bigint as dead_rows
  from enriched_relations
  group by schema_name
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
  'purpose', 'r5-database-size-read-only-diagnostic',
  'sourceHeadroomRunId', $2::bigint,
  'databaseHaltBytes', $3::bigint,
  'previousObservedDatabaseBytes', $4::bigint,
  'databaseBytes', pg_database_size(current_database())::bigint,
  'topRelations', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.total_bytes desc, r.schema_name, r.relation_name)
    from top_relations r
  ), '[]'::jsonb),
  'schemaTotals', coalesce((
    select jsonb_agg(to_jsonb(s) order by s.total_bytes desc, s.schema_name)
    from schema_totals s
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
  sourceHeadroomRunId,
  databaseHaltBytes,
  observedDatabaseBytes,
])
if (result.length !== 1) throw new Error(`unexpected rows:${result.length}`)
const diagnostic = object(result[0].diagnostic, 'diagnostic')
const recovery = object(diagnostic.recoverySummary, 'recovery')
const topRelations = array(diagnostic.topRelations, 'top relations')
const schemaTotals = array(diagnostic.schemaTotals, 'schema totals')
const workCounts = array(diagnostic.workCounts, 'work counts')
const messageCounts = array(diagnostic.messageCounts, 'message counts')
const referenceCounts = array(diagnostic.referenceCounts, 'reference counts')
const r5BatchCounts = array(diagnostic.r5BatchCounts, 'R5 batch counts')
const databaseBytes = integer(diagnostic.databaseBytes, 'database bytes')
const sorted = topRelations.every((relation, index) => (
  index === 0
  || integer(topRelations[index - 1].total_bytes, 'prior relation bytes')
    >= integer(relation.total_bytes, 'relation bytes')
))
const checks = {
  readOnly: true,
  exactSourceRun: Number(diagnostic.sourceHeadroomRunId) === sourceHeadroomRunId,
  exactHaltBoundary: Number(diagnostic.databaseHaltBytes) === databaseHaltBytes,
  priorGuardEvidenceBound:
    Number(diagnostic.previousObservedDatabaseBytes) === observedDatabaseBytes,
  databaseAtOrAboveHalt: databaseBytes >= databaseHaltBytes,
  relationBreakdownPresent: topRelations.length > 0 && schemaTotals.length > 0,
  relationBreakdownSorted: sorted,
  allowedSchemasOnly: topRelations.every((relation) => (
    relation.schema_name === 'public' || relation.schema_name === 'xrpl_r5_v1'
  )),
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

const relationLines = topRelations.slice(0, 20).map((relation) => (
  `| ${cell(relation.schema_name)} | ${cell(relation.relation_name)} | ${cell(relation.total_bytes)} | ${cell(relation.heap_bytes)} | ${cell(relation.index_bytes)} | ${cell(relation.toast_bytes)} | ${cell(relation.live_rows ?? relation.estimated_rows)} | ${cell(relation.dead_rows)} |`
))
const schemaLines = schemaTotals.map((schema) => (
  `| ${cell(schema.schema_name)} | ${cell(schema.total_bytes)} | ${cell(schema.heap_bytes)} | ${cell(schema.index_bytes)} | ${cell(schema.toast_bytes)} | ${cell(schema.dead_rows)} |`
))
const workLines = workCounts.map((entry) => (
  `| ${cell(entry.profile_id)} | ${cell(entry.status)} | ${cell(entry.row_count)} |`
))
const messageLines = messageCounts.map((entry) => (
  `| ${cell(entry.profile_id)} | ${cell(entry.status)} | ${cell(entry.row_count)} |`
))
const referenceLines = referenceCounts.map((entry) => (
  `| ${cell(entry.profile_id)} | ${cell(entry.work_status)} | ${cell(entry.row_count)} | ${cell(entry.work_count)} |`
))
const mismatchNames = Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name)
const markdown = `## R5 database-size read-only diagnostic

- run: ${code(sourceRunId)}
- commit: ${code(sourceCommit)}
- source headroom run: ${code(sourceHeadroomRunId)}
- database bytes: ${code(databaseBytes)}
- database halt bytes: ${code(databaseHaltBytes)}
- bytes over halt: ${code(Math.max(databaseBytes - databaseHaltBytes, 0))}
- previous guard evidence bytes: ${code(observedDatabaseBytes)}
- recovery status: ${code(recovery.status)}
- completed batches: ${code(recovery.completedBatches)}
- committed ledgers: ${code(recovery.committedLedgers)}
- mismatched checks: ${code(mismatchNames.length ? mismatchNames.join(',') : 'none')}
- read-only: ${code(true)}
- public reader unchanged: ${code(checks.publicReaderUnchanged)}
- Mainnet disabled: ${code(checks.mainnetDisabled)}
- stabilization authorized: ${code(false)}
- soak authorized: ${code(false)}

### Schema totals

| Schema | Total bytes | Heap bytes | Index bytes | TOAST bytes | Dead rows |
|---|---:|---:|---:|---:|---:|
${schemaLines.join('\n')}

### Largest relations

| Schema | Relation | Total bytes | Heap bytes | Index bytes | TOAST bytes | Live/estimated rows | Dead rows |
|---|---|---:|---:|---:|---:|---:|---:|
${relationLines.join('\n')}

### Phase work by profile and status

| Profile | Status | Rows |
|---|---|---:|
${workLines.join('\n')}

### Phase messages by profile and status

| Profile | Status | Rows |
|---|---|---:|
${messageLines.join('\n')}

### Reference rows by work profile and status

| Profile | Work status | Reference rows | Works |
|---|---|---:|---:|
${referenceLines.join('\n')}
`
await writeFile(`${output}/diagnostic.md`, markdown)
process.stdout.write(markdown)

if (mismatchNames.length > 0) {
  throw new Error(`database-size diagnostic checks failed: ${mismatchNames.join(',')}`)
}
