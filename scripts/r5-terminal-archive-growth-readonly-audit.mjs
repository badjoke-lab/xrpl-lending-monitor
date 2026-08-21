import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const COMPACT_V2_PROOF = Object.freeze({
  sourcePr: 1420,
  sourceHead: '24ae10ae9fc198fe116a540ec7bf6b08f27e6842',
  sourceRun: 32041777387,
  rows: 35000,
  v1Bytes: 62701568,
  v2Bytes: 29245440,
  savedBytes: 33456128,
  savedPercent: 53,
  modeledRows1500: 1500,
  modeledV1Bytes1500: 2744320,
  modeledV2Bytes1500: 1310720,
})
const RESTORE_RECLAIM_CANDIDATE_BYTES = 6144000

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
), primary_candidate as (
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
  'primary24hCandidateRows', e.rows,
  'primary24hCandidateLogicalTupleBytes', e.logical_tuple_bytes,
  'primary24hCandidatePayloadBytes', e.payload_bytes,
  'primary24hCandidateAvgPayloadBytes', round(e.avg_payload_bytes,2),
  'primary24hCandidateMaxPayloadBytes', e.max_payload_bytes,
  'primary24hCandidatePhaseCounts', jsonb_build_object('scan',e.scan_rows,'commit',e.commit_rows,'finalize',e.finalize_rows),
  'primary24hCandidatePayloadWorkIdRows', e.payload_work_id_rows,
  'projectedAdditionalArchiveBytesAtObservedPhysicalRatio', case when a.rows=0 then null else ceil(e.rows::numeric*r.total_bytes::numeric/a.rows)::bigint end,
  'projectedDatabaseBytesAtObservedPhysicalRatio', case when a.rows=0 then null else pg_database_size(current_database())::bigint + ceil(e.rows::numeric*r.total_bytes::numeric/a.rows)::bigint end
)::text as state
from params p cross join archive a cross join primary_candidate e cross join rel r cross join idx i;`

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
const primaryCandidateRows = Number(state.primary24hCandidateRows)
const databaseHeadroomBytes = Number(state.databaseHeadroomBytes)
if (!Number.isSafeInteger(primaryCandidateRows) || primaryCandidateRows < 0) fail('invalid primary candidate row count')
if (!Number.isSafeInteger(databaseHeadroomBytes)) fail('invalid database headroom')
const compactV2ModeledCandidateBytes = Math.ceil(primaryCandidateRows * COMPACT_V2_PROOF.v2Bytes / COMPACT_V2_PROOF.rows)
const headroomWithRestoreReclaimCandidateBytes = databaseHeadroomBytes + RESTORE_RECLAIM_CANDIDATE_BYTES
const compactV2CandidateFitsCurrentHeadroom = compactV2ModeledCandidateBytes <= databaseHeadroomBytes
const compactV2CandidateFitsWithRestoreReclaimCandidate = compactV2ModeledCandidateBytes <= headroomWithRestoreReclaimCandidateBytes
const evidence = {
  schemaVersion: 2,
  purpose: 'r5-terminal-archive-growth-readonly-audit',
  sourceCommit,
  ...state,
  primaryCandidateDefinition: "profile_id='supabase-devnet' AND status='completed' AND completed_at < observed_at - interval '24 hours'",
  formalPhaseBPreflightRequired: true,
  projectionClassification: 'primary_candidate_upper_bound_diagnostic',
  projectionCaveat: 'Observed physical bytes-per-row is a coarse current-footprint ratio including heap/index/TOAST allocation and is not a guaranteed marginal growth rate. The primary 24h candidate set is only the Phase B population basis; successor/root/revision/halt and other formal preflight gates are evaluated separately by the existing Phase B preflight. Existing bounded tranche deltas remain the stronger empirical mutation evidence.',
  compactV2Proof: COMPACT_V2_PROOF,
  compactV2ModeledCandidateBytes,
  compactV2ProjectionClassification: 'local_postgresql15_production_shaped_model_diagnostic',
  compactV2ProjectionCaveat: 'The compact-v2 projection scales the exact 35,000-row local PostgreSQL 15 proof from PR #1420. It is not a production marginal-growth guarantee and does not include an archive-v1-to-v2 migration transient peak. A false fit result is sufficient to reject compact-v2 backlog drain at the observed headroom; a true fit result would still require a separate provider-headroom migration gate.',
  restoreReclaimCandidateBytes: RESTORE_RECLAIM_CANDIDATE_BYTES,
  headroomWithRestoreReclaimCandidateBytes,
  compactV2CandidateFitsCurrentHeadroom,
  compactV2CandidateFitsWithRestoreReclaimCandidate,
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
  `- primary >24h candidate rows: \`${state.primary24hCandidateRows}\``,
  `- primary candidate payload total / avg / max bytes: \`${state.primary24hCandidatePayloadBytes} / ${state.primary24hCandidateAvgPayloadBytes} / ${state.primary24hCandidateMaxPayloadBytes}\``,
  `- primary candidate phase counts: \`${JSON.stringify(state.primary24hCandidatePhaseCounts)}\``,
  `- coarse added archive bytes at current physical ratio: \`${state.projectedAdditionalArchiveBytesAtObservedPhysicalRatio}\``,
  `- coarse projected database bytes at current physical ratio: \`${state.projectedDatabaseBytesAtObservedPhysicalRatio}\``,
  `- compact-v2 proof PR / head / run: \`#${COMPACT_V2_PROOF.sourcePr} / ${COMPACT_V2_PROOF.sourceHead} / ${COMPACT_V2_PROOF.sourceRun}\``,
  `- compact-v2 proof v1 / v2 / saved at 35,000 rows: \`${COMPACT_V2_PROOF.v1Bytes} / ${COMPACT_V2_PROOF.v2Bytes} / ${COMPACT_V2_PROOF.savedBytes} (${COMPACT_V2_PROOF.savedPercent}%)\``,
  `- compact-v2 modeled bytes for current candidate rows: \`${compactV2ModeledCandidateBytes}\``,
  `- compact-v2 candidate fits current headroom: \`${compactV2CandidateFitsCurrentHeadroom}\``,
  `- restore reclaim candidate / modeled headroom after it: \`${RESTORE_RECLAIM_CANDIDATE_BYTES} / ${headroomWithRestoreReclaimCandidateBytes}\``,
  `- compact-v2 candidate fits headroom after restore candidate: \`${compactV2CandidateFitsWithRestoreReclaimCandidate}\``,
  '',
  'The >24h completed set is the Phase B primary population basis only. Formal successor/root/revision/halt and other fail-close gates remain separately enforced by the existing Phase B preflight.',
  'Compact-v2 scaling is diagnostic only. A false fit rejects backlog drain at the observed headroom; a true fit still does not authorize migration because transient provider headroom remains unproved.',
  'No archive/Phase B mutation, compaction, R5 rearm, scheduler change, deployment, or Mainnet action is authorized.',
  '',`Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/terminal-archive-growth-summary.md`,`${s}\n`); console.log(s)
