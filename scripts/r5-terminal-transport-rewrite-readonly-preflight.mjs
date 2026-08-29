import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) { throw new Error(message) }
function env(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail('invalid arguments')
    out[key.slice(2)] = value
  }
  return out
}
function n(value) { return Number(value ?? 0) }
function ceilRatio(numerator, denominator) {
  if (denominator <= 0) return null
  return Math.ceil(numerator / denominator)
}

const DATABASE_HALT_BYTES = 400_000_000
const CAPACITY_RESERVE_BYTES = 122_420_032
const CAPACITY_FINAL_DATABASE_MAX_BYTES = DATABASE_HALT_BYTES - CAPACITY_RESERVE_BYTES
const MUTATION_CAPABILITY = /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke|refresh)\b/iu

const SQL = String.raw`with params as (
  select clock_timestamp() as observed_at
), eligible_messages as materialized (
  select m.message_id
  from public.xrpl_phase_messages m
  cross join params p
  where m.profile_id = 'supabase-devnet'
    and m.status = 'completed'
    and m.completed_at is not null
    and m.completed_at < p.observed_at - interval '24 hours'
), message_stats as (
  select
    count(*)::bigint as live_rows,
    count(*) filter (where e.message_id is not null)::bigint as candidate_rows,
    count(*) filter (where e.message_id is null)::bigint as retained_rows,
    coalesce(sum(pg_column_size(m))::bigint, 0) as live_tuple_bytes,
    coalesce(sum(pg_column_size(m)) filter (where e.message_id is not null)::bigint, 0) as candidate_tuple_bytes,
    coalesce(sum(pg_column_size(m)) filter (where e.message_id is null)::bigint, 0) as retained_tuple_bytes
  from public.xrpl_phase_messages m
  left join eligible_messages e on e.message_id = m.message_id
), successor_stats as (
  select
    count(*)::bigint as live_rows,
    count(*) filter (where e.message_id is not null)::bigint as candidate_rows,
    count(*) filter (where e.message_id is null)::bigint as retained_rows,
    coalesce(sum(pg_column_size(s))::bigint, 0) as live_tuple_bytes,
    coalesce(sum(pg_column_size(s)) filter (where e.message_id is not null)::bigint, 0) as candidate_tuple_bytes,
    coalesce(sum(pg_column_size(s)) filter (where e.message_id is null)::bigint, 0) as retained_tuple_bytes
  from public.xrpl_phase_successors s
  left join eligible_messages e on e.message_id = s.current_message_id
), archive_stats as (
  select
    count(*)::bigint as rows,
    coalesce(sum(pg_column_size(a))::bigint, 0) as tuple_bytes
  from xrpl_phase_archive_v1.terminal_messages a
), relation_stats as (
  select jsonb_build_object(
    'messages', jsonb_build_object(
      'heapBytes', pg_relation_size('public.xrpl_phase_messages'::regclass),
      'indexBytes', pg_indexes_size('public.xrpl_phase_messages'::regclass),
      'totalBytes', pg_total_relation_size('public.xrpl_phase_messages'::regclass),
      'liveRows', m.live_rows,
      'candidateRows', m.candidate_rows,
      'retainedRows', m.retained_rows,
      'liveTupleBytes', m.live_tuple_bytes,
      'candidateTupleBytes', m.candidate_tuple_bytes,
      'retainedTupleBytes', m.retained_tuple_bytes
    ),
    'successors', jsonb_build_object(
      'heapBytes', pg_relation_size('public.xrpl_phase_successors'::regclass),
      'indexBytes', pg_indexes_size('public.xrpl_phase_successors'::regclass),
      'totalBytes', pg_total_relation_size('public.xrpl_phase_successors'::regclass),
      'liveRows', s.live_rows,
      'candidateRows', s.candidate_rows,
      'retainedRows', s.retained_rows,
      'liveTupleBytes', s.live_tuple_bytes,
      'candidateTupleBytes', s.candidate_tuple_bytes,
      'retainedTupleBytes', s.retained_tuple_bytes
    ),
    'archive', jsonb_build_object(
      'heapBytes', pg_relation_size('xrpl_phase_archive_v1.terminal_messages'::regclass),
      'indexBytes', pg_indexes_size('xrpl_phase_archive_v1.terminal_messages'::regclass),
      'totalBytes', pg_total_relation_size('xrpl_phase_archive_v1.terminal_messages'::regclass),
      'rows', a.rows,
      'tupleBytes', a.tuple_bytes
    )
  ) as state
  from message_stats m cross join successor_stats s cross join archive_stats a
), index_stats as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename,
    'name', indexname,
    'bytes', pg_relation_size((quote_ident(schemaname)||'.'||quote_ident(indexname))::regclass),
    'definition', indexdef
  ) order by tablename, indexname), '[]'::jsonb) as state
  from pg_indexes
  where schemaname in ('public','xrpl_phase_archive_v1')
    and tablename in ('xrpl_phase_messages','xrpl_phase_successors','terminal_messages')
)
select jsonb_build_object(
  'observedAt', p.observed_at,
  'databaseBytes', pg_database_size(current_database())::bigint,
  'databaseHaltBytes', 400000000::bigint,
  'databaseHeadroomBytes', 400000000::bigint - pg_database_size(current_database())::bigint,
  'relations', r.state,
  'indexes', i.state
)::text as state
from params p cross join relation_stats r cross join index_stats i;`

if (!/^\s*with\b/iu.test(SQL)) fail('rewrite preflight must be a read-only CTE query')
if (MUTATION_CAPABILITY.test(SQL)) fail('rewrite preflight SQL contains forbidden mutation capability')

async function query() {
  const projectId = env('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = env('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL, read_only: true }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  if (!response.ok) fail(`query failed ${response.status}: ${text.slice(0, 500)}`)
  const rows = JSON.parse(text)
  const raw = rows?.[0]?.state
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  fail('rewrite preflight state missing')
}

function relation(raw) {
  return {
    heapBytes: n(raw?.heapBytes),
    indexBytes: n(raw?.indexBytes),
    totalBytes: n(raw?.totalBytes),
    liveRows: n(raw?.liveRows),
    candidateRows: n(raw?.candidateRows),
    retainedRows: n(raw?.retainedRows),
    liveTupleBytes: n(raw?.liveTupleBytes),
    candidateTupleBytes: n(raw?.candidateTupleBytes),
    retainedTupleBytes: n(raw?.retainedTupleBytes),
  }
}

const options = args(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const outputDir = resolve(options['output-dir'] ?? 'r5-index-footprint-readonly-probe')
await mkdir(outputDir, { recursive: true })

const state = await query()
const messages = relation(state.relations?.messages)
const successors = relation(state.relations?.successors)
const archive = {
  heapBytes: n(state.relations?.archive?.heapBytes),
  indexBytes: n(state.relations?.archive?.indexBytes),
  totalBytes: n(state.relations?.archive?.totalBytes),
  rows: n(state.relations?.archive?.rows),
  tupleBytes: n(state.relations?.archive?.tupleBytes),
}

if (messages.candidateRows <= 0) fail('no terminal message candidates to model')
if (messages.candidateRows !== successors.candidateRows) fail('message/successor candidate count mismatch')
if (archive.rows <= 0 || archive.tupleBytes <= 0 || archive.totalBytes <= 0) fail('archive baseline is unavailable')

const messageTupleAmplification = Math.max(1, ceilRatio(messages.totalBytes, messages.liveTupleBytes) ?? 1)
const successorTupleAmplification = Math.max(1, ceilRatio(successors.totalBytes, successors.liveTupleBytes) ?? 1)
const archiveTupleAmplification = Math.max(1, ceilRatio(archive.totalBytes, archive.tupleBytes) ?? 1)
const archivePhysicalBytesPerRow = Math.ceil(archive.totalBytes / archive.rows)

const compactMessagesUpperBytes = Math.max(
  messages.retainedTupleBytes * messageTupleAmplification,
  Math.ceil((messages.totalBytes / messages.liveRows) * messages.retainedRows),
)
const compactSuccessorsUpperBytes = Math.max(
  successors.retainedTupleBytes * successorTupleAmplification,
  Math.ceil((successors.totalBytes / successors.liveRows) * successors.retainedRows),
)

// We deliberately use the larger of two archive-growth estimates. The per-row estimate
// carries current fixed page/index overhead forward for every new row, while the tuple
// estimate carries the observed archive physical amplification forward.
const projectedArchiveGrowthByRows = archivePhysicalBytesPerRow * messages.candidateRows
const projectedArchiveGrowthByTuple = messages.candidateTupleBytes * archiveTupleAmplification
const projectedArchiveGrowthUpperBytes = Math.max(projectedArchiveGrowthByRows, projectedArchiveGrowthByTuple)

const currentTransportTotalBytes = messages.totalBytes + successors.totalBytes
const compactTransportUpperBytes = compactMessagesUpperBytes + compactSuccessorsUpperBytes
const projectedTransportReclaimLowerBytes = Math.max(0, currentTransportTotalBytes - compactTransportUpperBytes)
const projectedNetReclaimLowerBytes = Math.max(0, projectedTransportReclaimLowerBytes - projectedArchiveGrowthUpperBytes)
const projectedFinalDatabaseBytes = n(state.databaseBytes) - projectedTransportReclaimLowerBytes + projectedArchiveGrowthUpperBytes
const requiredReclaimBytes = Math.max(0, n(state.databaseBytes) - CAPACITY_FINAL_DATABASE_MAX_BYTES)

// Reviewed Phase B archives candidates before removal. Ordinary row removal does not
// shrink relation files. Therefore a full candidate archive must fit before physical
// rewrite can reduce the old live relations. A sequential rewrite then needs one compact
// replacement relation at a time; model the larger retained relation as the temp peak.
const projectedArchivePhasePeakBytes = n(state.databaseBytes) + projectedArchiveGrowthUpperBytes
const projectedSequentialRewritePeakBytes = projectedArchivePhasePeakBytes + Math.max(compactMessagesUpperBytes, compactSuccessorsUpperBytes)
const archivePhaseFitsHalt = projectedArchivePhasePeakBytes <= DATABASE_HALT_BYTES
const sequentialRewriteFitsHalt = projectedSequentialRewritePeakBytes <= DATABASE_HALT_BYTES
const finalCapacityReserveSafe = projectedFinalDatabaseBytes + CAPACITY_RESERVE_BYTES <= DATABASE_HALT_BYTES

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-terminal-transport-rewrite-readonly-preflight',
  sourceCommit,
  observedAt: state.observedAt,
  databaseBytes: n(state.databaseBytes),
  databaseHaltBytes: DATABASE_HALT_BYTES,
  databaseHeadroomBytes: n(state.databaseHeadroomBytes),
  capacityReserveBytes: CAPACITY_RESERVE_BYTES,
  capacityFinalDatabaseMaxBytes: CAPACITY_FINAL_DATABASE_MAX_BYTES,
  requiredReclaimBytes,
  messages,
  successors,
  archive,
  indexes: state.indexes ?? [],
  model: {
    messageTupleAmplification,
    successorTupleAmplification,
    archiveTupleAmplification,
    archivePhysicalBytesPerRow,
    compactMessagesUpperBytes,
    compactSuccessorsUpperBytes,
    compactTransportUpperBytes,
    projectedArchiveGrowthByRows,
    projectedArchiveGrowthByTuple,
    projectedArchiveGrowthUpperBytes,
    projectedTransportReclaimLowerBytes,
    projectedNetReclaimLowerBytes,
    projectedFinalDatabaseBytes,
    projectedArchivePhasePeakBytes,
    projectedSequentialRewritePeakBytes,
    archivePhaseFitsHalt,
    sequentialRewriteFitsHalt,
    finalCapacityReserveSafe,
  },
  interpretation: {
    compactUpperBound: 'max of current physical bytes per row and current physical-to-tuple amplification applied to retained rows; intended to overstate compact retained footprint',
    archiveGrowthUpperBound: 'max of current archive physical bytes per row and current archive physical-to-tuple amplification applied to eligible message tuple bytes; intended to overstate archive growth',
    peakModel: 'reviewed Phase B archives before removal; removal alone does not reduce allocated relation files; sequential rewrite adds one compact replacement relation at a time',
    scope: 'models the currently reviewed full Phase B candidate set followed by sequential physical rewrite; it does not model a new interleaved archive/rewrite strategy',
  },
  productionDatabaseReadOnly: true,
  measurementOnly: true,
  phaseBDeleteAuthorized: false,
  archiveMutationAuthorized: false,
  physicalRewriteAuthorized: false,
  vacuumAuthorized: false,
  schedulerMutationAuthorized: false,
  deploymentAuthorized: false,
  publicReaderMutationAuthorized: false,
  r5RearmAuthorized: false,
  mainnetDisabled: true,
}

const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const digest = createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/terminal-transport-rewrite-preflight.json`, serialized)
await writeFile(`${outputDir}/terminal-transport-rewrite-preflight.sha256`, `${digest}\n`)

const m = evidence.model
const summary = [
  '## Terminal transport rewrite read-only preflight',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database / halt / headroom: \`${evidence.databaseBytes} / ${DATABASE_HALT_BYTES} / ${evidence.databaseHeadroomBytes}\``,
  `- capacity reserve / required reclaim now: \`${CAPACITY_RESERVE_BYTES} / ${requiredReclaimBytes}\``,
  `- terminal candidates messages / successors: \`${messages.candidateRows} / ${successors.candidateRows}\``,
  `- current messages / successors total bytes: \`${messages.totalBytes} / ${successors.totalBytes}\``,
  `- retained messages / successors rows: \`${messages.retainedRows} / ${successors.retainedRows}\``,
  `- compact retained messages / successors upper bytes: \`${m.compactMessagesUpperBytes} / ${m.compactSuccessorsUpperBytes}\``,
  `- current archive rows / total bytes: \`${archive.rows} / ${archive.totalBytes}\``,
  `- archive physical bytes/row: \`${m.archivePhysicalBytesPerRow}\``,
  `- projected archive growth upper bytes: \`${m.projectedArchiveGrowthUpperBytes}\``,
  `- projected transport reclaim lower bytes: \`${m.projectedTransportReclaimLowerBytes}\``,
  `- projected net reclaim lower bytes after archive growth: \`${m.projectedNetReclaimLowerBytes}\``,
  `- projected final database bytes: \`${m.projectedFinalDatabaseBytes}\``,
  `- projected archive-before-removal peak: \`${m.projectedArchivePhasePeakBytes}\`; fits 400MB: \`${m.archivePhaseFitsHalt}\``,
  `- projected sequential rewrite peak: \`${m.projectedSequentialRewritePeakBytes}\`; fits 400MB: \`${m.sequentialRewriteFitsHalt}\``,
  `- final database + R5 reserve safe: \`${m.finalCapacityReserveSafe}\``,
  '',
  'This is a conservative model of the currently reviewed full Phase B archive/removal path followed by sequential rewrite. A false peak result does not prove every possible staged strategy is impossible; it blocks this reviewed full-set ordering from being treated as safe.',
  'No Phase B delete, archive mutation, physical rewrite, VACUUM, scheduler/deployment/public-reader mutation, R5 rearm, or Mainnet action is authorized.',
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/terminal-transport-rewrite-preflight-summary.md`, `${summary}\n`)
console.log(summary)
