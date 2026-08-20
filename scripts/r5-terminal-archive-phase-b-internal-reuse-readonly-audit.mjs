import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) {
  throw new Error(message)
}

function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail('invalid arguments')
    out[key.slice(2)] = value
  }
  return out
}

const SQL = String.raw`with params as (
  select
    clock_timestamp() as observed_at,
    current_setting('block_size')::bigint as block_size
), eligible_messages as materialized (
  select m.message_id
  from public.xrpl_phase_messages m
  cross join params p
  where m.profile_id = 'supabase-devnet'
    and m.status = 'completed'
    and m.completed_at is not null
    and m.completed_at < p.observed_at - interval '24 hours'
), message_rows as (
  select
    split_part(trim(both '()' from m.ctid::text), ',', 1)::bigint as heap_block,
    (e.message_id is not null) as candidate,
    pg_column_size(m)::bigint as tuple_bytes
  from public.xrpl_phase_messages m
  left join eligible_messages e on e.message_id = m.message_id
), message_blocks as (
  select
    heap_block,
    count(*)::bigint as live_rows,
    count(*) filter (where candidate)::bigint as candidate_rows,
    count(*) filter (where not candidate)::bigint as retained_rows,
    coalesce(sum(tuple_bytes) filter (where candidate), 0)::bigint as candidate_tuple_bytes,
    coalesce(sum(tuple_bytes) filter (where not candidate), 0)::bigint as retained_tuple_bytes
  from message_rows
  group by heap_block
), successor_rows as (
  select
    split_part(trim(both '()' from s.ctid::text), ',', 1)::bigint as heap_block,
    (e.message_id is not null) as candidate,
    pg_column_size(s)::bigint as tuple_bytes
  from public.xrpl_phase_successors s
  left join eligible_messages e on e.message_id = s.current_message_id
), successor_blocks as (
  select
    heap_block,
    count(*)::bigint as live_rows,
    count(*) filter (where candidate)::bigint as candidate_rows,
    count(*) filter (where not candidate)::bigint as retained_rows,
    coalesce(sum(tuple_bytes) filter (where candidate), 0)::bigint as candidate_tuple_bytes,
    coalesce(sum(tuple_bytes) filter (where not candidate), 0)::bigint as retained_tuple_bytes
  from successor_rows
  group by heap_block
), message_summary as (
  select jsonb_build_object(
    'heapBytes', pg_relation_size('public.xrpl_phase_messages'::regclass),
    'allocatedBlocks', pg_relation_size('public.xrpl_phase_messages'::regclass) / p.block_size,
    'liveBlocks', count(*)::bigint,
    'candidateOnlyBlocks', count(*) filter (where candidate_rows > 0 and retained_rows = 0)::bigint,
    'mixedCandidateBlocks', count(*) filter (where candidate_rows > 0 and retained_rows > 0)::bigint,
    'retainedOnlyBlocks', count(*) filter (where candidate_rows = 0 and retained_rows > 0)::bigint,
    'candidateOnlyBlockBytes', count(*) filter (where candidate_rows > 0 and retained_rows = 0)::bigint * p.block_size,
    'candidateRows', coalesce(sum(candidate_rows), 0)::bigint,
    'retainedRows', coalesce(sum(retained_rows), 0)::bigint,
    'candidateRowsOnCandidateOnlyBlocks', coalesce(sum(candidate_rows) filter (where candidate_rows > 0 and retained_rows = 0), 0)::bigint,
    'candidateRowsOnMixedBlocks', coalesce(sum(candidate_rows) filter (where candidate_rows > 0 and retained_rows > 0), 0)::bigint,
    'candidateTupleBytes', coalesce(sum(candidate_tuple_bytes), 0)::bigint,
    'candidateTupleBytesOnCandidateOnlyBlocks', coalesce(sum(candidate_tuple_bytes) filter (where candidate_rows > 0 and retained_rows = 0), 0)::bigint,
    'candidateTupleBytesOnMixedBlocks', coalesce(sum(candidate_tuple_bytes) filter (where candidate_rows > 0 and retained_rows > 0), 0)::bigint,
    'retainedTupleBytes', coalesce(sum(retained_tuple_bytes), 0)::bigint,
    'firstCandidateOnlyBlock', min(heap_block) filter (where candidate_rows > 0 and retained_rows = 0),
    'lastCandidateOnlyBlock', max(heap_block) filter (where candidate_rows > 0 and retained_rows = 0)
  ) as state
  from message_blocks
  cross join params p
), successor_summary as (
  select jsonb_build_object(
    'heapBytes', pg_relation_size('public.xrpl_phase_successors'::regclass),
    'allocatedBlocks', pg_relation_size('public.xrpl_phase_successors'::regclass) / p.block_size,
    'liveBlocks', count(*)::bigint,
    'candidateOnlyBlocks', count(*) filter (where candidate_rows > 0 and retained_rows = 0)::bigint,
    'mixedCandidateBlocks', count(*) filter (where candidate_rows > 0 and retained_rows > 0)::bigint,
    'retainedOnlyBlocks', count(*) filter (where candidate_rows = 0 and retained_rows > 0)::bigint,
    'candidateOnlyBlockBytes', count(*) filter (where candidate_rows > 0 and retained_rows = 0)::bigint * p.block_size,
    'candidateRows', coalesce(sum(candidate_rows), 0)::bigint,
    'retainedRows', coalesce(sum(retained_rows), 0)::bigint,
    'candidateRowsOnCandidateOnlyBlocks', coalesce(sum(candidate_rows) filter (where candidate_rows > 0 and retained_rows = 0), 0)::bigint,
    'candidateRowsOnMixedBlocks', coalesce(sum(candidate_rows) filter (where candidate_rows > 0 and retained_rows > 0), 0)::bigint,
    'candidateTupleBytes', coalesce(sum(candidate_tuple_bytes), 0)::bigint,
    'candidateTupleBytesOnCandidateOnlyBlocks', coalesce(sum(candidate_tuple_bytes) filter (where candidate_rows > 0 and retained_rows = 0), 0)::bigint,
    'candidateTupleBytesOnMixedBlocks', coalesce(sum(candidate_tuple_bytes) filter (where candidate_rows > 0 and retained_rows > 0), 0)::bigint,
    'retainedTupleBytes', coalesce(sum(retained_tuple_bytes), 0)::bigint,
    'firstCandidateOnlyBlock', min(heap_block) filter (where candidate_rows > 0 and retained_rows = 0),
    'lastCandidateOnlyBlock', max(heap_block) filter (where candidate_rows > 0 and retained_rows = 0)
  ) as state
  from successor_blocks
  cross join params p
)
select jsonb_build_object(
  'observedAt', p.observed_at,
  'databaseBytes', pg_database_size(current_database()),
  'blockSize', p.block_size,
  'eligibleMessageCount', (select count(*)::bigint from eligible_messages),
  'messages', m.state,
  'successors', s.state,
  'combinedCandidateOnlyBlockBytes',
    coalesce((m.state->>'candidateOnlyBlockBytes')::bigint, 0)
    + coalesce((s.state->>'candidateOnlyBlockBytes')::bigint, 0),
  'combinedCandidateTupleBytes',
    coalesce((m.state->>'candidateTupleBytes')::bigint, 0)
    + coalesce((s.state->>'candidateTupleBytes')::bigint, 0),
  'freeSpaceMapFunctionAvailable',
    to_regprocedure('pg_freespace(regclass,bigint)') is not null
    or to_regprocedure('pg_freespace(regclass,integer)') is not null,
  'pgstattupleApproxFunctionAvailable',
    to_regprocedure('pgstattuple_approx(regclass)') is not null
)::text as state
from params p
cross join message_summary m
cross join successor_summary s;`

if (!/^\s*with\b/iu.test(SQL)) fail('internal reuse audit must be a read-only CTE query')
if (/\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu.test(SQL)) {
  fail('internal reuse audit SQL contains forbidden mutation capability')
}

async function query() {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL, read_only: true }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  if (!response.ok) fail(`query failed ${response.status}: ${text.slice(0, 500)}`)
  const rows = JSON.parse(text)
  const raw = rows?.[0]?.state
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  fail('internal reuse audit state missing')
}

function number(value) {
  return Number(value ?? 0)
}

function normalizeRelation(raw) {
  return {
    heapBytes: number(raw?.heapBytes),
    allocatedBlocks: number(raw?.allocatedBlocks),
    liveBlocks: number(raw?.liveBlocks),
    candidateOnlyBlocks: number(raw?.candidateOnlyBlocks),
    mixedCandidateBlocks: number(raw?.mixedCandidateBlocks),
    retainedOnlyBlocks: number(raw?.retainedOnlyBlocks),
    candidateOnlyBlockBytes: number(raw?.candidateOnlyBlockBytes),
    candidateRows: number(raw?.candidateRows),
    retainedRows: number(raw?.retainedRows),
    candidateRowsOnCandidateOnlyBlocks: number(raw?.candidateRowsOnCandidateOnlyBlocks),
    candidateRowsOnMixedBlocks: number(raw?.candidateRowsOnMixedBlocks),
    candidateTupleBytes: number(raw?.candidateTupleBytes),
    candidateTupleBytesOnCandidateOnlyBlocks: number(raw?.candidateTupleBytesOnCandidateOnlyBlocks),
    candidateTupleBytesOnMixedBlocks: number(raw?.candidateTupleBytesOnMixedBlocks),
    retainedTupleBytes: number(raw?.retainedTupleBytes),
    firstCandidateOnlyBlock: raw?.firstCandidateOnlyBlock == null ? null : number(raw.firstCandidateOnlyBlock),
    lastCandidateOnlyBlock: raw?.lastCandidateOnlyBlock == null ? null : number(raw.lastCandidateOnlyBlock),
  }
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const outputDir = resolve(options['output-dir'] ?? 'r5-index-footprint-readonly-probe')
await mkdir(outputDir, { recursive: true })

const state = await query()
const evidence = {
  schemaVersion: 1,
  purpose: 'r5-terminal-archive-phase-b-internal-reuse-readonly-audit',
  sourceCommit,
  observedAt: state.observedAt,
  databaseBytes: number(state.databaseBytes),
  blockSize: number(state.blockSize),
  eligibleMessageCount: number(state.eligibleMessageCount),
  messages: normalizeRelation(state.messages),
  successors: normalizeRelation(state.successors),
  combinedCandidateOnlyBlockBytes: number(state.combinedCandidateOnlyBlockBytes),
  combinedCandidateTupleBytes: number(state.combinedCandidateTupleBytes),
  freeSpaceMapFunctionAvailable: state.freeSpaceMapFunctionAvailable === true,
  pgstattupleApproxFunctionAvailable: state.pgstattupleApproxFunctionAvailable === true,
  candidateDefinition: "message profile_id='supabase-devnet' AND status='completed' AND completed_at < observed_at - interval '24 hours'; successor mapping candidate when current_message_id is an eligible message_id",
  interpretation: {
    candidateOnlyBlockBytes: 'structural full-page reuse upper bound after the formally authorized archive/removal path and ordinary cleanup; these bytes remain allocated unless trailing pages can be truncated',
    candidateTupleBytes: 'sum of current candidate tuple datum sizes; useful as a placement signal, not a guarantee that the same number of bytes becomes immediately reusable',
    mixedCandidateBlocks: 'candidate and retained tuples coexist, so tuple space may become reusable after cleanup but is not counted as full-page reusable capacity',
  },
  phaseBArchiveRemovalAuthorized: false,
  cleanupAuthorized: false,
  physicalRewriteAuthorized: false,
  schedulerMutationAuthorized: false,
  deploymentAuthorized: false,
  publicReaderMutationAuthorized: false,
  r5RearmAuthorized: false,
  mainnetDisabled: true,
  productionDatabaseReadOnly: true,
}

const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const digest = createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/terminal-archive-phase-b-internal-reuse.json`, serialized)
await writeFile(`${outputDir}/terminal-archive-phase-b-internal-reuse.sha256`, `${digest}\n`)

const summary = [
  '## Terminal archive Phase B internal reuse read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${evidence.databaseBytes}\``,
  `- eligible live message rows: \`${evidence.eligibleMessageCount}\``,
  `- block size: \`${evidence.blockSize}\``,
  `- messages heap / allocated blocks: \`${evidence.messages.heapBytes} / ${evidence.messages.allocatedBlocks}\``,
  `- messages candidate-only / mixed blocks: \`${evidence.messages.candidateOnlyBlocks} / ${evidence.messages.mixedCandidateBlocks}\``,
  `- messages candidate-only block bytes: \`${evidence.messages.candidateOnlyBlockBytes}\``,
  `- messages candidate tuple bytes total / mixed blocks: \`${evidence.messages.candidateTupleBytes} / ${evidence.messages.candidateTupleBytesOnMixedBlocks}\``,
  `- successors heap / allocated blocks: \`${evidence.successors.heapBytes} / ${evidence.successors.allocatedBlocks}\``,
  `- successors candidate-only / mixed blocks: \`${evidence.successors.candidateOnlyBlocks} / ${evidence.successors.mixedCandidateBlocks}\``,
  `- successors candidate-only block bytes: \`${evidence.successors.candidateOnlyBlockBytes}\``,
  `- successors candidate tuple bytes total / mixed blocks: \`${evidence.successors.candidateTupleBytes} / ${evidence.successors.candidateTupleBytesOnMixedBlocks}\``,
  `- combined candidate-only block bytes: \`${evidence.combinedCandidateOnlyBlockBytes}\``,
  `- combined candidate tuple bytes: \`${evidence.combinedCandidateTupleBytes}\``,
  `- pg_freespace available / pgstattuple_approx available: \`${evidence.freeSpaceMapFunctionAvailable} / ${evidence.pgstattupleApproxFunctionAvailable}\``,
  '',
  'Candidate-only block bytes are a structural reuse bound, not immediate database shrink. Mixed-page tuple bytes are reported separately and are not promoted to guaranteed reusable capacity.',
  'This audit does not authorize Phase B archive/removal, cleanup, physical rewrite, scheduler/deployment/public-reader changes, R5 rearm, or Mainnet.',
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/terminal-archive-phase-b-internal-reuse-summary.md`, `${summary}\n`)
console.log(summary)
