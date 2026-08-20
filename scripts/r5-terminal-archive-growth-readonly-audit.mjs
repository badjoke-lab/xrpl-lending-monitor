import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) { throw new Error(message) }
function need(name, pattern = null) { const v = process.env[name]; if (!v) fail(`missing ${name}`); if (pattern && !pattern.test(v)) fail(`invalid ${name}`); return v }
function parse(argv) { const o = {}; for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith('--') || argv[i + 1] == null) fail('invalid arguments'); o[argv[i].slice(2)] = argv[i + 1] } return o }

const SQL = String.raw`with params as (
  select clock_timestamp() as observed_at
), archive as (
  select
    count(*)::bigint as rows,
    coalesce(sum(pg_column_size(t)), 0)::bigint as logical_tuple_bytes,
    coalesce(sum(pg_column_size(t.payload)), 0)::bigint as payload_bytes,
    coalesce(avg(pg_column_size(t.payload)), 0)::numeric as avg_payload_bytes,
    coalesce(max(pg_column_size(t.payload)), 0)::bigint as max_payload_bytes,
    count(*) filter (where phase='scan')::bigint as scan_rows,
    count(*) filter (where phase='commit')::bigint as commit_rows,
    count(*) filter (where phase='finalize')::bigint as finalize_rows,
    count(*) filter (where payload ? 'workId')::bigint as payload_work_id_rows
  from xrpl_phase_archive_v1.terminal_messages t
), candidate as (
  select
    count(*)::bigint as rows,
    coalesce(sum(pg_column_size(m)), 0)::bigint as logical_tuple_bytes,
    coalesce(sum(pg_column_size(m.payload)), 0)::bigint as payload_bytes,
    coalesce(avg(pg_column_size(m.payload)), 0)::numeric as avg_payload_bytes,
    coalesce(max(pg_column_size(m.payload)), 0)::bigint as max_payload_bytes,
    count(*) filter (where phase='scan')::bigint as scan_rows,
    count(*) filter (where phase='commit')::bigint as commit_rows,
    count(*) filter (where phase='finalize')::bigint as finalize_rows,
    count(*) filter (where payload ? 'workId')::bigint as payload_work_id_rows
  from public.xrpl_phase_messages m
  cross join params p
  where m.profile_id='supabase-devnet'
    and m.status='completed'
    and m.completed_at is not null
    and m.completed_at < p.observed_at - interval '24 hours'
), rel as (
  select
    pg_relation_size('xrpl_phase_archive_v1.terminal_messages'::regclass)::bigint as heap_bytes,
    pg_indexes_size('xrpl_phase_archive_v1.terminal_messages'::regclass)::bigint as index_bytes,
    pg_total_relation_size('xrpl_phase_archive_v1.terminal_messages'::regclass)::bigint as total_bytes,
    case when c.reltoastrelid = 0 then 0 else pg_total_relation_size(c.reltoastrelid)::bigint end as toast_total_bytes
  from pg_class c
  where c.oid='xrpl_phase_archive_v1.terminal_messages'::regclass
), idx as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', ci.relname,
    'bytes', pg_relation_size(ci.oid),
    'primary', i.indisprimary,
    'unique', i.indisunique
  ) order by pg_relation_size(ci.oid) desc, ci.relname), '[]'::jsonb) as items
  from pg_index i
  join pg_class ci on ci.oid=i.indexrelid
  where i.indrelid='xrpl_phase_archive_v1.terminal_messages'::regclass
)
select jsonb_build_object(
  'observedAt', p.observed_at,
  'databaseBytes', pg_database_size(current_database()),
  'databaseHeadroomBytes', 400000000::bigint-pg_database_size(current_database())::bigint,
  'archiveRows', a.rows,
  'archiveHeapBytes', r.heap_bytes,
  'archiveIndexBytes', r.index_bytes,
  'archiveToastTotalBytes', r.toast_total_bytes,
  'archiveTotalBytes', r.total_bytes,
  'archiveLogicalTupleBytes', a.logical_tuple_bytes,
  'archivePayloadBytes', a.payload_bytes,
  'archiveAvgPayloadBytes', round(a.avg_payload_bytes,2),
  'archiveMaxPayloadBytes', a.max_payload_bytes,
  'archivePhysicalBytesPerRow', case when a.rows=0 then null else round(r.total_bytes::numeric/a.rows,2) end,
  'archivePhaseCounts', jsonb_build_object('scan',a.scan_rows,'commit',a.commit_rows,'finalize',a.finalize_rows),
  'archivePayloadWorkIdRows', a.payload_work_id_rows,
  'archiveIndexes', i.items,
  'eligibleRows', e.rows,
  'eligibleLogicalTupleBytes', e.logical_tuple_bytes,
  'eligiblePayloadBytes', e.payload_bytes,
  'eligibleAvgPayloadBytes', round(e.avg_payload_bytes,2),
  'eligibleMaxPayloadBytes', e.max_payload_bytes,
  'eligiblePhaseCounts', jsonb_build_object('scan',e.scan_rows,'commit',e.commit_rows,'finalize',e.finalize_rows),
  'eligiblePayloadWorkIdRows', e.payload_work_id_rows,
  'projectedAdditionalArchiveBytesAtObservedPhysicalRatio', case when a.rows=0 then null else ceil(e.rows::numeric*r.total_bytes::numeric/a.rows)::bigint end,
  'projectedDatabaseBytesAtObservedPhysicalRatio', case when a.rows=0 then null else pg_database_size(current_database())::bigint + ceil(e.rows::numeric*r.total_bytes::numeric/a.rows)::bigint end
)::text as state
from params p cross join archive a cross join candidate e cross join rel r cross join idx i;`

if (!/^\s*with\b/iu.test(SQL) || /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu.test(SQL)) fail('archive growth audit must be SELECT/read_only only')

async function query() {
  const project = need('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = need('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL, read_only: true }), signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  if (!response.ok) fail(`query failed ${response.status}: ${text.slice(0,500)}`)
  const rows = JSON.parse(text); const raw = rows?.[0]?.state
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

const options = parse(process.argv.slice(2)); const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const outputDir = resolve(options['output-dir'] ?? 'r5-index-footprint-readonly-probe'); await mkdir(outputDir,{recursive:true})
const state = await query()
const evidence = {
  schemaVersion: 1,
  purpose: 'r5-terminal-archive-growth-readonly-audit',
  sourceCommit,
  ...state,
  projectionCaveat: 'Observed physical bytes-per-row is a coarse current-footprint ratio including heap/index/TOAST allocation and is not a guaranteed marginal growth rate. Existing bounded tranche deltas remain the stronger empirical mutation evidence.',
  archiveMutationAuthorized: false,
  archiveCompactionAuthorized: false,
  phaseBMutationAuthorized: false,
  r5RearmAuthorized: false,
  productionDatabaseReadOnly: true,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`; const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/terminal-archive-growth.json`,serialized); await writeFile(`${outputDir}/terminal-archive-growth.sha256`,`${digest}\n`)
const s=[
  '## Terminal archive growth read-only audit','',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes / headroom: \`${state.databaseBytes} / ${state.databaseHeadroomBytes}\``,
  `- archive rows: \`${state.archiveRows}\``,
  `- archive heap / indexes / TOAST / total bytes: \`${state.archiveHeapBytes} / ${state.archiveIndexBytes} / ${state.archiveToastTotalBytes} / ${state.archiveTotalBytes}\``,
  `- archive physical bytes per row: \`${state.archivePhysicalBytesPerRow}\``,
  `- archive payload total / avg / max bytes: \`${state.archivePayloadBytes} / ${state.archiveAvgPayloadBytes} / ${state.archiveMaxPayloadBytes}\``,
  `- archive phase counts: \`${JSON.stringify(state.archivePhaseCounts)}\``,
  `- eligible historical messages: \`${state.eligibleRows}\``,
  `- eligible payload total / avg / max bytes: \`${state.eligiblePayloadBytes} / ${state.eligibleAvgPayloadBytes} / ${state.eligibleMaxPayloadBytes}\``,
  `- eligible phase counts: \`${JSON.stringify(state.eligiblePhaseCounts)}\``,
  `- coarse added archive bytes at current physical ratio: \`${state.projectedAdditionalArchiveBytesAtObservedPhysicalRatio}\``,
  `- coarse projected database bytes at current physical ratio: \`${state.projectedDatabaseBytesAtObservedPhysicalRatio}\``,
  '',
  'Projection is diagnostic only; it is not a mutation forecast guarantee. No archive/Phase B mutation, compaction, R5 rearm, scheduler change, deployment, or Mainnet action is authorized.',
  '',`Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/terminal-archive-growth-summary.md`,`${s}\n`); console.log(s)
