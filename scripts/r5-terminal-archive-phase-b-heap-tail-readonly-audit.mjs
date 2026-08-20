import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) { throw new Error(message) }
function env(name, pattern = null) { const v = process.env[name]; if (!v) fail(`missing ${name}`); if (pattern && !pattern.test(v)) fail(`invalid ${name}`); return v }
function args(argv) { const o = {}; for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith('--') || argv[i + 1] == null) fail('invalid arguments'); o[argv[i].slice(2)] = argv[i + 1] } return o }

const SQL = String.raw`with params as (
  select clock_timestamp() as observed_at,
         current_setting('block_size')::bigint as block_size
), classified as (
  select
    split_part(trim(both '()' from m.ctid::text), ',', 1)::bigint as heap_block,
    (m.profile_id='supabase-devnet' and m.status='completed' and m.completed_at < p.observed_at-interval '24 hours') as eligible
  from public.xrpl_phase_messages m
  cross join params p
), bounds as (
  select
    count(*)::bigint as live_rows,
    count(*) filter (where eligible)::bigint as eligible_rows,
    count(distinct heap_block)::bigint as live_blocks,
    count(distinct heap_block) filter (where eligible)::bigint as eligible_blocks,
    max(heap_block) as max_live_block,
    max(heap_block) filter (where not eligible) as max_retained_block
  from classified
), tail as (
  select
    count(*)::bigint as eligible_tail_rows,
    count(distinct c.heap_block)::bigint as eligible_tail_blocks,
    min(c.heap_block) as first_tail_block,
    max(c.heap_block) as last_tail_block
  from classified c
  cross join bounds b
  where c.eligible
    and (b.max_retained_block is null or c.heap_block > b.max_retained_block)
)
select jsonb_build_object(
  'observedAt', p.observed_at,
  'databaseBytes', pg_database_size(current_database()),
  'messageHeapBytes', pg_relation_size('public.xrpl_phase_messages'::regclass),
  'blockSize', p.block_size,
  'liveRows', b.live_rows,
  'eligibleRows', b.eligible_rows,
  'liveBlocks', b.live_blocks,
  'eligibleBlocks', b.eligible_blocks,
  'maxLiveBlock', b.max_live_block,
  'maxRetainedBlock', b.max_retained_block,
  'eligibleTailRows', t.eligible_tail_rows,
  'eligibleTailBlocksObserved', t.eligible_tail_blocks,
  'firstTailBlock', t.first_tail_block,
  'lastTailBlock', t.last_tail_block,
  'contiguousTailBlocks', case
    when b.max_live_block is null then 0
    when b.max_retained_block is null then b.max_live_block + 1
    else greatest(0, b.max_live_block - b.max_retained_block)
  end,
  'estimatedTailBytes', case
    when b.max_live_block is null then 0
    when b.max_retained_block is null then (b.max_live_block + 1) * p.block_size
    else greatest(0, b.max_live_block - b.max_retained_block) * p.block_size
  end
)::text as state
from params p cross join bounds b cross join tail t;`

if (!/^\s*with\b/iu.test(SQL) || /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster)\b/iu.test(SQL)) fail('heap-tail audit must be read-only SELECT/CTE only')

async function query() {
  const pid = env('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = env('SUPABASE_ACCESS_TOKEN')
  const r = await fetch(`https://api.supabase.com/v1/projects/${pid}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL, read_only: true }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await r.text()
  if (!r.ok) fail(`query failed ${r.status}: ${text.slice(0, 500)}`)
  const rows = JSON.parse(text)
  const raw = rows?.[0]?.state
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

const o = args(process.argv.slice(2))
if (!/^[a-f0-9]{40}$/u.test(o['source-commit'] ?? '')) fail('invalid source commit')
const out = resolve(o['output-dir'] ?? 'r5-index-footprint-readonly-probe')
await mkdir(out, { recursive: true })
const s = await query()

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-terminal-archive-phase-b-heap-tail-readonly-audit',
  sourceCommit: o['source-commit'],
  observedAt: s.observedAt,
  databaseBytes: Number(s.databaseBytes),
  messageHeapBytes: Number(s.messageHeapBytes),
  blockSize: Number(s.blockSize),
  liveRows: Number(s.liveRows),
  eligibleRows: Number(s.eligibleRows),
  liveBlocks: Number(s.liveBlocks),
  eligibleBlocks: Number(s.eligibleBlocks),
  maxLiveBlock: s.maxLiveBlock == null ? null : Number(s.maxLiveBlock),
  maxRetainedBlock: s.maxRetainedBlock == null ? null : Number(s.maxRetainedBlock),
  eligibleTailRows: Number(s.eligibleTailRows),
  eligibleTailBlocksObserved: Number(s.eligibleTailBlocksObserved),
  firstTailBlock: s.firstTailBlock == null ? null : Number(s.firstTailBlock),
  lastTailBlock: s.lastTailBlock == null ? null : Number(s.lastTailBlock),
  contiguousTailBlocks: Number(s.contiguousTailBlocks),
  estimatedTailBytes: Number(s.estimatedTailBytes),
  candidateDefinition: "profile_id='supabase-devnet' AND status='completed' AND completed_at < observed_at - interval '24 hours'",
  interpretation: 'physical-layout diagnostic only; preflight successor/consumer gates still apply before any Phase B mutation',
  phaseBDeleteAuthorized: false,
  vacuumAuthorized: false,
  r5RearmAuthorized: false,
  productionDatabaseReadOnly: true,
}

const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const digest = createHash('sha256').update(serialized).digest('hex')
await writeFile(`${out}/terminal-archive-phase-b-heap-tail.json`, serialized)
await writeFile(`${out}/terminal-archive-phase-b-heap-tail.sha256`, `${digest}\n`)
const summary = [
  '## Terminal archive Phase B heap-tail read-only audit',
  '',
  `- source commit: \`${evidence.sourceCommit}\``,
  `- database bytes: \`${evidence.databaseBytes}\``,
  `- message heap bytes: \`${evidence.messageHeapBytes}\``,
  `- live / eligible rows: \`${evidence.liveRows} / ${evidence.eligibleRows}\``,
  `- max live / retained heap block: \`${evidence.maxLiveBlock} / ${evidence.maxRetainedBlock}\``,
  `- eligible rows in candidate-only live tail: \`${evidence.eligibleTailRows}\``,
  `- contiguous candidate-only tail blocks: \`${evidence.contiguousTailBlocks}\``,
  `- estimated candidate-only live tail bytes: \`${evidence.estimatedTailBytes}\``,
  '- Phase B delete authorized: `false`',
  '- VACUUM authorized: `false`',
  '- R5 rearm authorized: `false`',
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${out}/terminal-archive-phase-b-heap-tail-summary.md`, `${summary}\n`)
console.log(summary)
