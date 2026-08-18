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
with lengths as (
  select
    octet_length(work_id)::bigint as work_id_bytes,
    octet_length(semantic_class)::bigint as semantic_class_bytes,
    octet_length(canonical_key)::bigint as canonical_key_bytes,
    (octet_length(work_id) + octet_length(semantic_class) + octet_length(canonical_key))::bigint as pkey_text_bytes,
    (octet_length(semantic_class) + octet_length(canonical_key) + 8)::bigint as lookup_key_bytes
  from public.xrpl_phase_reference_rows
), metrics as (
  select
    count(*)::bigint as rows,
    min(work_id_bytes)::bigint as work_id_min,
    round(avg(work_id_bytes), 3) as work_id_avg,
    percentile_disc(0.50) within group (order by work_id_bytes)::bigint as work_id_p50,
    percentile_disc(0.95) within group (order by work_id_bytes)::bigint as work_id_p95,
    percentile_disc(0.99) within group (order by work_id_bytes)::bigint as work_id_p99,
    max(work_id_bytes)::bigint as work_id_max,
    min(semantic_class_bytes)::bigint as semantic_class_min,
    round(avg(semantic_class_bytes), 3) as semantic_class_avg,
    max(semantic_class_bytes)::bigint as semantic_class_max,
    min(canonical_key_bytes)::bigint as canonical_key_min,
    round(avg(canonical_key_bytes), 3) as canonical_key_avg,
    percentile_disc(0.50) within group (order by canonical_key_bytes)::bigint as canonical_key_p50,
    percentile_disc(0.95) within group (order by canonical_key_bytes)::bigint as canonical_key_p95,
    percentile_disc(0.99) within group (order by canonical_key_bytes)::bigint as canonical_key_p99,
    max(canonical_key_bytes)::bigint as canonical_key_max,
    min(pkey_text_bytes)::bigint as pkey_text_min,
    round(avg(pkey_text_bytes), 3) as pkey_text_avg,
    percentile_disc(0.50) within group (order by pkey_text_bytes)::bigint as pkey_text_p50,
    percentile_disc(0.95) within group (order by pkey_text_bytes)::bigint as pkey_text_p95,
    percentile_disc(0.99) within group (order by pkey_text_bytes)::bigint as pkey_text_p99,
    max(pkey_text_bytes)::bigint as pkey_text_max,
    min(lookup_key_bytes)::bigint as lookup_key_min,
    round(avg(lookup_key_bytes), 3) as lookup_key_avg,
    percentile_disc(0.50) within group (order by lookup_key_bytes)::bigint as lookup_key_p50,
    percentile_disc(0.95) within group (order by lookup_key_bytes)::bigint as lookup_key_p95,
    percentile_disc(0.99) within group (order by lookup_key_bytes)::bigint as lookup_key_p99,
    max(lookup_key_bytes)::bigint as lookup_key_max
  from lengths
), indexes as (
  select
    idx.relname as index_name,
    pg_relation_size(idx.oid)::bigint as index_bytes,
    i.indisprimary as primary_index,
    i.indisunique as unique_index,
    exists(select 1 from pg_constraint c where c.conindid = idx.oid) as constraint_backed,
    pg_get_indexdef(idx.oid) as definition
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  where i.indrelid = 'public.xrpl_phase_reference_rows'::regclass
)
select jsonb_build_object(
  'schemaVersion', 1,
  'rows', m.rows,
  'databaseBytes', pg_database_size(current_database()),
  'heapBytes', pg_relation_size('public.xrpl_phase_reference_rows'::regclass),
  'tableTotalBytes', pg_total_relation_size('public.xrpl_phase_reference_rows'::regclass),
  'estimatedDeadRows', coalesce((select n_dead_tup::bigint from pg_stat_all_tables where relid='public.xrpl_phase_reference_rows'::regclass),0),
  'workIdBytes', jsonb_build_object('min',m.work_id_min,'avg',m.work_id_avg,'p50',m.work_id_p50,'p95',m.work_id_p95,'p99',m.work_id_p99,'max',m.work_id_max),
  'semanticClassBytes', jsonb_build_object('min',m.semantic_class_min,'avg',m.semantic_class_avg,'max',m.semantic_class_max),
  'canonicalKeyBytes', jsonb_build_object('min',m.canonical_key_min,'avg',m.canonical_key_avg,'p50',m.canonical_key_p50,'p95',m.canonical_key_p95,'p99',m.canonical_key_p99,'max',m.canonical_key_max),
  'pkeyTextBytes', jsonb_build_object('min',m.pkey_text_min,'avg',m.pkey_text_avg,'p50',m.pkey_text_p50,'p95',m.pkey_text_p95,'p99',m.pkey_text_p99,'max',m.pkey_text_max),
  'lookupKeyBytes', jsonb_build_object('min',m.lookup_key_min,'avg',m.lookup_key_avg,'p50',m.lookup_key_p50,'p95',m.lookup_key_p95,'p99',m.lookup_key_p99,'max',m.lookup_key_max),
  'indexes', coalesce((select jsonb_agg(to_jsonb(x) order by x.index_bytes desc, x.index_name) from indexes x),'[]'::jsonb),
  'safetyBoundary', jsonb_build_object(
    'readOnly', true,
    'noRowValuesPublished', true,
    'noIndexMutationAuthorized', true,
    'noRowMutationAuthorized', true,
    'noVacuumAuthorized', true,
    'noSchedulerMutationAuthorized', true,
    'noDeploymentAuthorized', true,
    'mainnetDisabled', true,
    'r5RearmAuthorized', false
  )
)::text as state
from metrics m;
`

if (MUTATION_CAPABILITY.test(SQL)) fail('reference key-shape probe contains mutation capability')

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
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) fail(`management query failed: ${response.status}`)
  return response.json()
}

function findState(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail('unexpected management query result')
  const raw = rows[0]?.state
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  fail('reference key-shape state missing')
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
const outputDir = options['output-dir'] ?? 'r5-index-footprint-readonly-probe'
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const state = findState(await managementQuery(SQL))
const safety = state.safetyBoundary ?? {}
for (const key of ['readOnly','noRowValuesPublished','noIndexMutationAuthorized','noRowMutationAuthorized','noVacuumAuthorized','noSchedulerMutationAuthorized','noDeploymentAuthorized','mainnetDisabled']) {
  if (safety[key] !== true) fail(`missing safety boundary: ${key}`)
}
if (safety.r5RearmAuthorized !== false) fail('R5 rearm safety boundary drifted')
if (Number(state.rows) <= 0) fail('reference rows missing')

const evidence = {
  sourceCommit,
  querySha256: createHash('sha256').update(SQL).digest('hex'),
  state,
}
const serialized = `${JSON.stringify(evidence, null, 2)}\n`
await mkdir(outputDir, { recursive: true })
await writeFile(`${outputDir}/reference-index-key-shape.json`, serialized)
await writeFile(`${outputDir}/reference-index-key-shape.sha256`, `${createHash('sha256').update(serialized).digest('hex')}\n`)

const pkey = (state.indexes ?? []).find((x) => x.index_name === 'xrpl_phase_reference_rows_pkey')
const lookup = (state.indexes ?? []).find((x) => x.index_name === 'xrpl_phase_reference_lookup_idx')
if (!pkey || !lookup) fail('reference indexes missing')

const summary = [
  '## R5 reference index key-shape read-only probe',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- reference rows: \`${state.rows}\``,
  `- estimated dead rows: \`${state.estimatedDeadRows}\``,
  `- pkey bytes: \`${pkey.index_bytes}\``,
  `- lookup bytes: \`${lookup.index_bytes}\``,
  `- work_id bytes avg / p95 / p99 / max: \`${state.workIdBytes.avg} / ${state.workIdBytes.p95} / ${state.workIdBytes.p99} / ${state.workIdBytes.max}\``,
  `- canonical_key bytes avg / p95 / p99 / max: \`${state.canonicalKeyBytes.avg} / ${state.canonicalKeyBytes.p95} / ${state.canonicalKeyBytes.p99} / ${state.canonicalKeyBytes.max}\``,
  `- pkey text bytes avg / p95 / p99 / max: \`${state.pkeyTextBytes.avg} / ${state.pkeyTextBytes.p95} / ${state.pkeyTextBytes.p99} / ${state.pkeyTextBytes.max}\``,
  `- lookup key bytes avg / p95 / p99 / max: \`${state.lookupKeyBytes.avg} / ${state.lookupKeyBytes.p95} / ${state.lookupKeyBytes.p99} / ${state.lookupKeyBytes.max}\``,
  '- production mutation: `false`',
  '- raw row values published: `false`',
].join('\n')
await writeFile(`${outputDir}/reference-index-key-shape-summary.md`, `${summary}\n`)
console.log(summary)
