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

const SQL = String.raw`with archive as (
  select
    a.*,
    s.network as stream_network,
    s.epoch_id as stream_epoch_id,
    s.base_identity as stream_base_identity
  from xrpl_phase_archive_v1.terminal_messages a
  left join public.xrpl_phase_streams s on s.profile_id=a.profile_id
), resolved as (
  select
    a.*,
    w.work_id as durable_work_id,
    w.status as durable_work_status,
    w.network as work_network,
    w.epoch_id as work_epoch_id,
    w.base_identity as work_base_identity,
    w.previous_ledger_index as work_previous_ledger_index,
    w.start_ledger_index as work_start_ledger_index,
    w.expected_parent_hash as work_expected_parent_hash,
    w.scanned_end_ledger_index as work_scanned_end_ledger_index,
    w.final_ledger_hash as work_final_ledger_hash,
    w.payload_digest as work_payload_digest,
    w.expected_payload_chunks,
    w.expected_commit_chunks,
    c.status as durable_commit_chunk_status,
    case when a.phase='commit' then (a.payload->>'chunkIndex')::integer else null end as archive_chunk_index
  from archive a
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
    order by w.created_at, w.work_id
    limit 1
  ) w on true
  left join public.xrpl_phase_commit_chunks c
    on a.phase='commit'
   and c.work_id=w.work_id
   and c.chunk_index=(a.payload->>'chunkIndex')::integer
), checked as (
  select
    r.*,
    case r.phase
      when 'scan' then concat(
        'scan:v1:',r.payload->>'network',':',r.payload->>'epochId',':',r.payload->>'baseIdentity',':',
        ((r.payload->>'expectedPreviousLedgerIndex')::bigint)::text,':',upper(r.payload->>'expectedPreviousLedgerHash'),':',
        ((r.payload->>'scanSequence')::integer)::text)
      when 'commit' then concat('commit:v1:',replace(r.durable_work_id,':','%3A'),':',r.archive_chunk_index::text)
      when 'finalize' then concat('finalize:v1:',replace(r.durable_work_id,':','%3A'))
    end as reconstructed_message_id,
    case r.phase
      when 'scan' then case
        when r.durable_work_id is not null then concat('commit:v1:',replace(r.durable_work_id,':','%3A'),':0')
        else concat(
          'scan:v1:',r.payload->>'network',':',r.payload->>'epochId',':',r.payload->>'baseIdentity',':',
          ((r.payload->>'expectedPreviousLedgerIndex')::bigint)::text,':',upper(r.payload->>'expectedPreviousLedgerHash'),':',
          (((r.payload->>'scanSequence')::integer)+1)::text)
      end
      when 'commit' then case
        when r.archive_chunk_index+1 < r.expected_commit_chunks
          then concat('commit:v1:',replace(r.durable_work_id,':','%3A'),':',(r.archive_chunk_index+1)::text)
        else concat('finalize:v1:',replace(r.durable_work_id,':','%3A'))
      end
      when 'finalize' then concat(
        'scan:v1:',r.work_network,':',r.work_epoch_id,':',r.work_base_identity,':',
        r.work_scanned_end_ledger_index::text,':',upper(r.work_final_ledger_hash),':0')
    end as reconstructed_successor_id,
    case r.phase
      when 'scan' then jsonb_build_object(
        'schemaVersion',1,'phase','scan','messageId',r.message_id,
        'network',r.payload->>'network','epochId',r.payload->>'epochId','baseIdentity',r.payload->>'baseIdentity',
        'expectedPreviousLedgerIndex',(r.payload->>'expectedPreviousLedgerIndex')::bigint,
        'expectedPreviousLedgerHash',r.payload->>'expectedPreviousLedgerHash',
        'scanSequence',(r.payload->>'scanSequence')::integer)
      when 'commit' then jsonb_build_object(
        'schemaVersion',1,'phase','commit','messageId',r.message_id,
        'workId',r.durable_work_id,'chunkIndex',r.archive_chunk_index)
      when 'finalize' then jsonb_build_object(
        'schemaVersion',1,'phase','finalize','messageId',r.message_id,'workId',r.durable_work_id)
    end as reconstructed_payload,
    case r.phase
      when 'scan' then jsonb_build_object(
        'status','staged',
        'workId',r.durable_work_id,
        'startLedgerIndex',r.work_start_ledger_index,
        'endLedgerIndex',r.work_scanned_end_ledger_index,
        'payloadDigest',r.work_payload_digest,
        'payloadChunks',r.expected_payload_chunks,
        'semanticCounts',jsonb_build_object('ledgers',1,'totalRecords',1))
      when 'commit' then jsonb_build_object(
        'status','committing',
        'workId',r.durable_work_id,
        'chunkIndex',r.archive_chunk_index,
        'operationCount',1,
        'rowMutationCount',1)
      when 'finalize' then jsonb_build_object(
        'status','committed',
        'workId',r.durable_work_id,
        'ledgerIndex',r.work_scanned_end_ledger_index,
        'ledgerHash',r.work_final_ledger_hash)
    end as reconstructed_generic_result,
    case r.phase
      when 'scan' then r.durable_work_id is not null and r.durable_work_status='committed'
      when 'commit' then
        r.durable_work_status='committed'
        and r.archive_chunk_index >= 0
        and r.archive_chunk_index < r.expected_commit_chunks
      when 'finalize' then r.durable_work_status='committed'
      else false
    end as durable_membership_proven
  from resolved r
), digested as (
  select
    c.*,
    case when c.reconstructed_generic_result is null then null else encode(
      extensions.digest(convert_to(c.reconstructed_generic_result::text,'UTF8'),'sha256'),
      'hex') end as reconstructed_generic_result_digest
  from checked c
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'archiveRows',count(*),
  'phaseCounts',jsonb_build_object(
    'scan',count(*) filter(where phase='scan'),
    'commit',count(*) filter(where phase='commit'),
    'finalize',count(*) filter(where phase='finalize')),
  'durableMembershipProvenRows',count(*) filter(where durable_membership_proven),
  'durableMembershipUnprovenRows',count(*) filter(where not durable_membership_proven),
  'productiveScanRows',count(*) filter(where phase='scan' and durable_work_id is not null),
  'caughtUpScanRowsWithoutWork',count(*) filter(where phase='scan' and durable_work_id is null),
  'messageIdReconstructionMatchRows',count(*) filter(where reconstructed_message_id=message_id),
  'successorIdReconstructionMatchRows',count(*) filter(where reconstructed_successor_id=successor_message_id),
  'payloadReconstructionMatchRows',count(*) filter(where reconstructed_payload=payload),
  'fullyReconstructableRows',count(*) filter(
    where durable_membership_proven
      and reconstructed_message_id=message_id
      and reconstructed_successor_id=successor_message_id
      and reconstructed_payload=payload),
  'messageIdMismatchRows',count(*) filter(where reconstructed_message_id is distinct from message_id),
  'successorIdMismatchRows',count(*) filter(where reconstructed_successor_id is distinct from successor_message_id),
  'payloadMismatchRows',count(*) filter(where reconstructed_payload is distinct from payload),
  'commitRowsWithCommittedWork',count(*) filter(where phase='commit' and durable_work_status='committed'),
  'commitRowsProvenByCommittedWorkCertificate',count(*) filter(
    where phase='commit'
      and durable_work_status='committed'
      and archive_chunk_index >= 0
      and archive_chunk_index < expected_commit_chunks),
  'commitRowsExpectedSingleChunk',count(*) filter(where phase='commit' and expected_commit_chunks=1),
  'commitRowsExpectedMultiChunk',count(*) filter(where phase='commit' and expected_commit_chunks>1),
  'commitRowsOutsideExpectedChunkRange',count(*) filter(
    where phase='commit'
      and (archive_chunk_index < 0 or archive_chunk_index >= expected_commit_chunks)),
  'commitRowsWithRetainedCompletedChunk',count(*) filter(where phase='commit' and durable_commit_chunk_status='completed'),
  'commitRowsMissingRetainedCompletedChunk',count(*) filter(where phase='commit' and durable_commit_chunk_status is distinct from 'completed'),
  'genericResultDigestMatchRows',count(*) filter(where reconstructed_generic_result_digest=result_digest),
  'genericResultDigestMismatchRows',count(*) filter(where reconstructed_generic_result_digest is distinct from result_digest),
  'scanGenericResultDigestMatchRows',count(*) filter(where phase='scan' and reconstructed_generic_result_digest=result_digest),
  'commitGenericResultDigestMatchRows',count(*) filter(where phase='commit' and reconstructed_generic_result_digest=result_digest),
  'finalizeGenericResultDigestMatchRows',count(*) filter(where phase='finalize' and reconstructed_generic_result_digest=result_digest),
  'finalizeRowsMissingCommittedWork',count(*) filter(where phase='finalize' and durable_work_status is distinct from 'committed'),
  'scanRowsWithStreamIdentityMismatch',count(*) filter(where phase='scan' and (
    stream_network is distinct from payload->>'network'
    or stream_epoch_id is distinct from payload->>'epochId'
    or stream_base_identity is distinct from payload->>'baseIdentity')),
  'scanRowsNetworkMismatch',count(*) filter(where phase='scan' and stream_network is distinct from payload->>'network'),
  'scanRowsEpochMismatch',count(*) filter(where phase='scan' and stream_epoch_id is distinct from payload->>'epochId'),
  'scanRowsBaseIdentityMismatch',count(*) filter(where phase='scan' and stream_base_identity is distinct from payload->>'baseIdentity'),
  'resultDigestRows',count(*) filter(where result_digest is not null),
  'completedAtRows',count(*) filter(where completed_at is not null)
)::text as state
from digested;`

if (!/^\s*with\b/iu.test(SQL) || /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu.test(SQL)) {
  fail('derived-membership audit must be SELECT/read_only only')
}
if (/public\.xrpl_phase_(scan|commit|finalize)_message_id\s*\(/u.test(SQL)) {
  fail('derived-membership audit must not require EXECUTE on private phase identity helpers')
}

async function query() {
  const project = need('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = need('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL, read_only: true }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  if (!response.ok) fail(`query failed ${response.status}: ${text.slice(0,500)}`)
  const rows = JSON.parse(text)
  const raw = rows?.[0]?.state
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

const options = parse(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const outputDir = resolve(options['output-dir'] ?? 'r5-terminal-archive-derived-membership-readonly')
await mkdir(outputDir,{recursive:true})
const state = await query()
const resultDigestDerivabilityProven = state.genericResultDigestMatchRows === state.resultDigestRows && state.genericResultDigestMismatchRows === 0
const evidence = {
  schemaVersion:1,
  purpose:'r5-terminal-archive-derived-membership-readonly-audit',
  sourceCommit,
  ...state,
  interpretation:'Tests whether archived transport membership, exact message identity, successor identity, canonical phase payload shape, and current generic-path result digests are derivable from durable phase work state plus the archived row being audited. For commit rows, committed work plus a canonical in-range chunk index is treated as the durable completion-membership certificate because supported finalize paths cannot mark the work committed until required commit evidence has completed. The certificate survives later commit-chunk retention cleanup. Caught-up scans without durable work remain explicitly unproven.',
  commitMembershipCertificate:{
    predicate:"xrpl_phase_work.status='committed' and 0 <= chunkIndex < expected_commit_chunks",
    genericFinalizeInvariant:'single-chunk finalize requires completed commit chunk 0 before marking work committed',
    portableFinalizeInvariant:'portable finalize requires completed commit chunk count to equal expected_commit_chunks before marking work committed',
    archiveCompatibilityInvariant:'terminal archive compatibility patch prepends duplicate-completion handling and does not weaken either finalize evidence gate',
    retainedCommitChunkRowRequired:false,
  },
  identityReconstructionImplementation:'inline canonical v1 formulas; no EXECUTE grant on phase identity helper functions required',
  resultDigestDerivabilityProven,
  resultDigestReconstructionScope:'current archived generic single-chunk scan/commit/finalize result shapes; future portable multi-chunk result derivation remains a separate compatibility proof',
  completedAtDerivabilityProven:false,
  archiveMutationAuthorized:false,
  phaseBMutationAuthorized:false,
  r5RearmAuthorized:false,
  productionDatabaseReadOnly:true,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/derived-membership.json`,serialized)
await writeFile(`${outputDir}/derived-membership.sha256`,`${digest}\n`)
const summary=[
  '## Terminal archive durable-membership read-only audit','',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${state.databaseBytes}\``,
  `- archive rows: \`${state.archiveRows}\``,
  `- phase counts: \`${JSON.stringify(state.phaseCounts)}\``,
  `- durable membership proven / unproven: \`${state.durableMembershipProvenRows} / ${state.durableMembershipUnprovenRows}\``,
  `- productive scans / caught-up scans without work: \`${state.productiveScanRows} / ${state.caughtUpScanRowsWithoutWork}\``,
  `- commit membership by committed-work certificate: \`${state.commitRowsProvenByCommittedWorkCertificate}\``,
  `- commit expected single / multi chunk: \`${state.commitRowsExpectedSingleChunk} / ${state.commitRowsExpectedMultiChunk}\``,
  `- commit rows outside expected chunk range: \`${state.commitRowsOutsideExpectedChunkRange}\``,
  `- retained completed commit-chunk rows / missing after retention: \`${state.commitRowsWithRetainedCompletedChunk} / ${state.commitRowsMissingRetainedCompletedChunk}\``,
  `- exact message / successor / payload reconstruction matches: \`${state.messageIdReconstructionMatchRows} / ${state.successorIdReconstructionMatchRows} / ${state.payloadReconstructionMatchRows}\``,
  `- fully reconstructable rows: \`${state.fullyReconstructableRows}\``,
  `- generic result-digest matches / mismatches: \`${state.genericResultDigestMatchRows} / ${state.genericResultDigestMismatchRows}\``,
  `- generic result-digest scan / commit / finalize matches: \`${state.scanGenericResultDigestMatchRows} / ${state.commitGenericResultDigestMatchRows} / ${state.finalizeGenericResultDigestMatchRows}\``,
  `- scan current-stream mismatch total / network / epoch / base: \`${state.scanRowsWithStreamIdentityMismatch} / ${state.scanRowsNetworkMismatch} / ${state.scanRowsEpochMismatch} / ${state.scanRowsBaseIdentityMismatch}\``,
  `- result-digest derivability proven for current archive: \`${resultDigestDerivabilityProven}\``,
  `- completed-at derivability proven: \`false\``,
  '',
  'This is a SELECT/read_only diagnostic only. It does not authorize archive deletion, compaction, Phase B, R5 rearm, scheduler/deployment/public-reader changes, or Mainnet.',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/derived-membership-summary.md`,`${summary}\n`)
console.log(summary)
