import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) { throw new Error(message) }
function need(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parse(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) fail('invalid arguments')
    out[argv[i].slice(2)] = argv[i + 1]
  }
  return out
}

const SQL = String.raw`with resolved as (
  select
    a.message_hash,
    a.phase,
    a.payload,
    a.completed_at as archive_completed_at,
    w.work_id,
    w.created_at as work_created_at,
    w.committed_at as work_committed_at,
    c.completed_at as commit_chunk_completed_at
  from xrpl_phase_archive_v1.terminal_messages a
  left join lateral (
    select w.*
    from public.xrpl_phase_work w
    where w.profile_id=a.profile_id
      and (
        (a.phase='scan'
          and w.network=a.payload->>'network'
          and w.epoch_id=a.payload->>'epochId'
          and w.base_identity=a.payload->>'baseIdentity'
          and w.previous_ledger_index=(a.payload->>'expectedPreviousLedgerIndex')::bigint
          and w.expected_parent_hash=upper(a.payload->>'expectedPreviousLedgerHash'))
        or
        (a.phase in ('commit','finalize') and w.work_id=a.payload->>'workId')
      )
    order by w.created_at,w.work_id
    limit 1
  ) w on true
  left join public.xrpl_phase_commit_chunks c
    on a.phase='commit'
   and c.work_id=w.work_id
   and c.chunk_index=(a.payload->>'chunkIndex')::integer
), checked as (
  select *,
    case phase
      when 'scan' then work_created_at
      when 'commit' then commit_chunk_completed_at
      when 'finalize' then work_committed_at
    end as durable_completed_at
  from resolved
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'archiveRows',count(*),
  'productiveScanRows',count(*) filter(where phase='scan' and work_id is not null),
  'caughtUpScanRowsWithoutWork',count(*) filter(where phase='scan' and work_id is null),
  'commitRows',count(*) filter(where phase='commit'),
  'finalizeRows',count(*) filter(where phase='finalize'),
  'durableCompletedAtRows',count(*) filter(where durable_completed_at is not null),
  'exactCompletedAtMatchRows',count(*) filter(where durable_completed_at=archive_completed_at),
  'exactCompletedAtMismatchRows',count(*) filter(where durable_completed_at is not null and durable_completed_at is distinct from archive_completed_at),
  'productiveScanExactRows',count(*) filter(where phase='scan' and work_id is not null and work_created_at=archive_completed_at),
  'commitExactRows',count(*) filter(where phase='commit' and commit_chunk_completed_at=archive_completed_at),
  'finalizeExactRows',count(*) filter(where phase='finalize' and work_committed_at=archive_completed_at),
  'caughtUpScanCompletedAtUnprovenRows',count(*) filter(where phase='scan' and work_id is null)
)::text as state
from checked;`

if (!/^\s*with\b/iu.test(SQL) || /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu.test(SQL)) {
  fail('derived completion-time audit must be SELECT/read_only only')
}

async function query() {
  const project = need('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = need('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:SQL,read_only:true}),
    signal:AbortSignal.timeout(60000),
  })
  const text=await response.text()
  if (!response.ok) fail(`query failed ${response.status}: ${text.slice(0,500)}`)
  const rows=JSON.parse(text)
  const raw=rows?.[0]?.state
  return typeof raw==='string'?JSON.parse(raw):raw
}

const options=parse(process.argv.slice(2))
const sourceCommit=options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit')
const outputDir=resolve(options['output-dir']??'r5-terminal-archive-derived-completion-time-readonly')
await mkdir(outputDir,{recursive:true})
const state=await query()
const evidence={
  schemaVersion:1,
  purpose:'r5-terminal-archive-derived-completion-time-readonly-audit',
  sourceCommit,
  ...state,
  expectedDurableSources:{productiveScan:'xrpl_phase_work.created_at',commit:'xrpl_phase_commit_chunks.completed_at',finalize:'xrpl_phase_work.committed_at',caughtUpScan:'unproven'},
  resultDigestDerivabilityProven:false,
  archiveMutationAuthorized:false,
  phaseBMutationAuthorized:false,
  r5RearmAuthorized:false,
  productionDatabaseReadOnly:true,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/derived-completion-time.json`,serialized)
await writeFile(`${outputDir}/derived-completion-time.sha256`,`${digest}\n`)
const summary=[
  '## Terminal archive completion-time derivation read-only audit','',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${state.databaseBytes}\``,
  `- archive rows: \`${state.archiveRows}\``,
  `- durable completed-at rows / exact matches / mismatches: \`${state.durableCompletedAtRows} / ${state.exactCompletedAtMatchRows} / ${state.exactCompletedAtMismatchRows}\``,
  `- productive scan exact / caught-up unproven: \`${state.productiveScanExactRows} / ${state.caughtUpScanCompletedAtUnprovenRows}\``,
  `- commit exact / finalize exact: \`${state.commitExactRows} / ${state.finalizeExactRows}\``,
  `- result-digest derivability proven: \`false\``,
  '',
  'SELECT/read_only only. No archive mutation/deletion, Phase B, R5 rearm, scheduler/deployment/public-reader change, or Mainnet action is authorized.',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/derived-completion-time-summary.md`,`${summary}\n`)
console.log(summary)
