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

const SQL = String.raw`with archive_scans as (
  select
    'archive'::text as storage,
    a.message_id,
    a.profile_id,
    a.payload,
    a.successor_message_id,
    a.completed_at
  from xrpl_phase_archive_v1.terminal_messages a
  where a.profile_id='supabase-devnet'
    and a.phase='scan'
), live_completed_scans as (
  select
    'live'::text as storage,
    m.message_id,
    m.profile_id,
    m.payload,
    m.successor_message_id,
    m.completed_at
  from public.xrpl_phase_messages m
  where m.profile_id='supabase-devnet'
    and m.phase='scan'
    and m.status='completed'
    and m.completed_at is not null
), completed_scans as (
  select
    s.*,
    case
      when s.payload->>'scanSequence' ~ '^(0|[1-9][0-9]*)$'
        then (s.payload->>'scanSequence')::bigint
      else null
    end as scan_sequence,
    jsonb_build_object(
      'profileId',s.profile_id,
      'network',s.payload->>'network',
      'epochId',s.payload->>'epochId',
      'baseIdentity',s.payload->>'baseIdentity',
      'expectedPreviousLedgerIndex',s.payload->>'expectedPreviousLedgerIndex',
      'expectedPreviousLedgerHash',upper(s.payload->>'expectedPreviousLedgerHash')
    ) as boundary
  from (
    select * from archive_scans
    union all
    select * from live_completed_scans
  ) s
), scan_successors as (
  select
    s.*,
    ((archive_successor.message_hash is not null)::integer
      + (live_successor.message_id is not null)::integer) as successor_match_count,
    case
      when archive_successor.message_hash is not null then 'archive'
      when live_successor.message_id is not null then 'live'
      else null
    end as successor_storage,
    coalesce(archive_successor.phase,live_successor.phase) as successor_phase,
    coalesce(archive_successor.payload,live_successor.payload) as successor_payload,
    case
      when archive_successor.message_hash is not null then 'completed'
      else live_successor.status
    end as successor_status,
    case
      when coalesce(archive_successor.payload,live_successor.payload)->>'scanSequence'
        ~ '^(0|[1-9][0-9]*)$'
        then (coalesce(archive_successor.payload,live_successor.payload)->>'scanSequence')::bigint
      else null
    end as successor_scan_sequence,
    w.work_id as successor_work_id,
    w.status as successor_work_status,
    w.network as successor_work_network,
    w.epoch_id as successor_work_epoch_id,
    w.base_identity as successor_work_base_identity,
    w.previous_ledger_index as successor_work_previous_ledger_index,
    w.expected_parent_hash as successor_work_expected_parent_hash
  from completed_scans s
  left join xrpl_phase_archive_v1.terminal_messages archive_successor
    on archive_successor.message_hash = extensions.digest(
      convert_to(s.successor_message_id,'UTF8'),
      'sha256'
    )
   and archive_successor.message_id=s.successor_message_id
   and archive_successor.profile_id=s.profile_id
  left join public.xrpl_phase_messages live_successor
    on live_successor.message_id=s.successor_message_id
   and live_successor.profile_id=s.profile_id
  left join public.xrpl_phase_work w
    on coalesce(archive_successor.phase,live_successor.phase)='commit'
   and coalesce(archive_successor.payload,live_successor.payload)->>'chunkIndex'
      ~ '^(0|[1-9][0-9]*)$'
   and (coalesce(archive_successor.payload,live_successor.payload)->>'chunkIndex')::integer=0
   and w.work_id=coalesce(archive_successor.payload,live_successor.payload)->>'workId'
), classified as (
  select
    r.*,
    case
      when r.scan_sequence is null then 'unknown'
      when r.successor_match_count<>1 then 'unknown'
      when r.successor_phase='commit'
        and r.successor_payload->>'chunkIndex'='0'
        and r.successor_work_id is not null
        and r.successor_work_network=r.payload->>'network'
        and r.successor_work_epoch_id=r.payload->>'epochId'
        and r.successor_work_base_identity=r.payload->>'baseIdentity'
        and r.successor_work_previous_ledger_index::text=r.payload->>'expectedPreviousLedgerIndex'
        and upper(r.successor_work_expected_parent_hash)=upper(r.payload->>'expectedPreviousLedgerHash')
        then 'productive'
      when r.successor_phase='scan'
        and r.successor_payload->>'network'=r.payload->>'network'
        and r.successor_payload->>'epochId'=r.payload->>'epochId'
        and r.successor_payload->>'baseIdentity'=r.payload->>'baseIdentity'
        and r.successor_payload->>'expectedPreviousLedgerIndex'=r.payload->>'expectedPreviousLedgerIndex'
        and upper(r.successor_payload->>'expectedPreviousLedgerHash')=upper(r.payload->>'expectedPreviousLedgerHash')
        and r.successor_scan_sequence=r.scan_sequence+1
        then 'caught_up'
      else 'unknown'
    end as outcome
  from scan_successors r
), boundary_stats as (
  select
    boundary,
    count(*) as row_count,
    count(distinct scan_sequence) as distinct_sequence_count,
    min(scan_sequence) as min_sequence,
    max(scan_sequence) as max_sequence,
    count(*) filter(where outcome='productive') as productive_count,
    count(*) filter(where outcome='caught_up') as caught_up_count,
    count(*) filter(where outcome='unknown') as unknown_count,
    min(scan_sequence) filter(where outcome='productive') as productive_sequence,
    count(*) filter(where scan_sequence is null) as invalid_sequence_count
  from classified
  group by boundary
), checked_boundaries as (
  select
    b.*,
    case
      when b.invalid_sequence_count<>0 or b.unknown_count<>0 then false
      when b.min_sequence<>0 then false
      when b.distinct_sequence_count<>b.row_count then false
      when b.max_sequence+1<>b.row_count then false
      when b.productive_count=1
        then b.productive_sequence=b.max_sequence and b.caught_up_count=b.max_sequence
      when b.productive_count=0
        then b.caught_up_count=b.row_count
      else false
    end as contiguous_outcome_chain
  from boundary_stats b
), productive_map as (
  select
    successor_work_id as work_id,
    scan_sequence as source_scan_sequence,
    storage as scan_storage,
    successor_work_status as work_status
  from classified
  where outcome='productive'
), productive_map_stats as (
  select
    count(*) as row_count,
    count(distinct work_id) as distinct_work_count,
    min(source_scan_sequence) as min_source_sequence,
    max(source_scan_sequence) as max_source_sequence,
    count(*) filter(where source_scan_sequence=0) as sequence_zero_count,
    count(*) filter(where source_scan_sequence>0) as nonzero_sequence_count,
    count(*) filter(where work_status='committed') as committed_work_count,
    count(*) filter(where work_status<>'committed') as noncommitted_work_count,
    case when count(*)=0 then null else encode(
      extensions.digest(
        convert_to(string_agg(work_id||':'||source_scan_sequence::text,E'\n' order by work_id),'UTF8'),
        'sha256'
      ),
      'hex'
    ) end as mapping_digest
  from productive_map
), committed_work_coverage as (
  select
    count(*) as committed_work_count,
    count(*) filter(where p.work_id is not null) as mapped_committed_work_count,
    count(*) filter(where p.work_id is null) as unmapped_committed_work_count
  from public.xrpl_phase_work w
  left join (select distinct work_id from productive_map) p using(work_id)
  where w.profile_id='supabase-devnet'
    and w.status='committed'
), active_scans as (
  select
    m.message_id,
    m.profile_id,
    m.payload,
    case
      when m.payload->>'scanSequence' ~ '^(0|[1-9][0-9]*)$'
        then (m.payload->>'scanSequence')::bigint
      else null
    end as scan_sequence,
    jsonb_build_object(
      'profileId',m.profile_id,
      'network',m.payload->>'network',
      'epochId',m.payload->>'epochId',
      'baseIdentity',m.payload->>'baseIdentity',
      'expectedPreviousLedgerIndex',m.payload->>'expectedPreviousLedgerIndex',
      'expectedPreviousLedgerHash',upper(m.payload->>'expectedPreviousLedgerHash')
    ) as boundary
  from public.xrpl_phase_messages m
  where m.profile_id='supabase-devnet'
    and m.phase='scan'
    and m.status in ('pending','leased','retry')
), classified_boundary_rollup as (
  select
    boundary,
    count(*) as completed_count,
    count(*) filter(where outcome='caught_up') as caught_up_count,
    count(*) filter(where outcome='productive') as productive_count,
    count(*) filter(where outcome='unknown') as unknown_count,
    max(scan_sequence) as max_completed_sequence
  from classified
  group by boundary
), active_checks as (
  select
    a.*,
    coalesce(r.completed_count,0) as completed_same_boundary_count,
    coalesce(r.caught_up_count,0) as caught_up_same_boundary_count,
    coalesce(r.productive_count,0) as productive_same_boundary_count,
    coalesce(r.unknown_count,0) as unknown_same_boundary_count,
    r.max_completed_sequence as max_completed_same_boundary_sequence
  from active_scans a
  left join classified_boundary_rollup r on r.boundary=a.boundary
), open_boundary_coverage as (
  select
    count(*) as open_boundary_count,
    count(*) filter(where a.boundary is not null) as active_backed_open_boundary_count,
    count(*) filter(where a.boundary is null) as orphan_open_boundary_count
  from checked_boundaries b
  left join (select distinct boundary from active_scans) a on a.boundary=b.boundary
  where b.productive_count=0
    and b.caught_up_count=b.row_count
    and b.unknown_count=0
), sequence_histogram as (
  select coalesce(jsonb_object_agg(scan_sequence::text,row_count order by scan_sequence),'{}'::jsonb) as value
  from (
    select scan_sequence,count(*) as row_count
    from classified
    where scan_sequence is not null
    group by scan_sequence
  ) h
), outcome_counts as (
  select
    count(*) filter(where outcome='productive') as productive_count,
    count(*) filter(where outcome='caught_up') as caught_up_count,
    count(*) filter(where outcome='unknown') as unknown_count,
    count(*) filter(where storage='archive') as archive_scan_count,
    count(*) filter(where storage='live') as live_completed_scan_count,
    count(*) filter(where scan_sequence=0) as sequence_zero_count,
    count(*) filter(where scan_sequence>0) as nonzero_sequence_count,
    min(scan_sequence) as min_sequence,
    max(scan_sequence) as max_sequence
  from classified
), transport_meta as (
  select
    (select count(*) from xrpl_phase_archive_v1.terminal_messages a where a.profile_id='supabase-devnet')
      + (select count(*) from public.xrpl_phase_messages m where m.profile_id='supabase-devnet')
      as transport_rows,
    (select count(*)
      from xrpl_phase_archive_v1.terminal_messages a
      join public.xrpl_phase_messages m on m.message_id=a.message_id
      where a.profile_id='supabase-devnet' and m.profile_id='supabase-devnet')
      as duplicate_message_ids
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'transportRows',(select transport_rows from transport_meta),
  'transportDuplicateMessageIds',(select duplicate_message_ids from transport_meta),
  'completedScanRows',(select count(*) from classified),
  'archiveScanRows',(select archive_scan_count from outcome_counts),
  'liveCompletedScanRows',(select live_completed_scan_count from outcome_counts),
  'productiveScanRows',(select productive_count from outcome_counts),
  'caughtUpScanRows',(select caught_up_count from outcome_counts),
  'unknownScanRows',(select unknown_count from outcome_counts),
  'scanSequenceMin',(select min_sequence from outcome_counts),
  'scanSequenceMax',(select max_sequence from outcome_counts),
  'scanSequenceZeroRows',(select sequence_zero_count from outcome_counts),
  'scanSequenceNonzeroRows',(select nonzero_sequence_count from outcome_counts),
  'scanSequenceHistogram',(select value from sequence_histogram),
  'boundaryCount',(select count(*) from checked_boundaries),
  'validBoundaryChains',(select count(*) from checked_boundaries where contiguous_outcome_chain),
  'invalidBoundaryChains',(select count(*) from checked_boundaries where not contiguous_outcome_chain),
  'closedProductiveBoundaries',(select count(*) from checked_boundaries where productive_count=1),
  'openCaughtUpOnlyBoundaries',(select open_boundary_count from open_boundary_coverage),
  'activeBackedOpenCaughtUpOnlyBoundaries',(select active_backed_open_boundary_count from open_boundary_coverage),
  'orphanOpenCaughtUpOnlyBoundaries',(select orphan_open_boundary_count from open_boundary_coverage),
  'productiveMappingRows',(select row_count from productive_map_stats),
  'productiveMappingDistinctWorks',(select distinct_work_count from productive_map_stats),
  'productiveSourceSequenceMin',(select min_source_sequence from productive_map_stats),
  'productiveSourceSequenceMax',(select max_source_sequence from productive_map_stats),
  'productiveSourceSequenceZeroRows',(select sequence_zero_count from productive_map_stats),
  'productiveSourceSequenceNonzeroRows',(select nonzero_sequence_count from productive_map_stats),
  'productiveMappedCommittedWorks',(select committed_work_count from productive_map_stats),
  'productiveMappedNoncommittedWorks',(select noncommitted_work_count from productive_map_stats),
  'productiveMappingDigest',(select mapping_digest from productive_map_stats),
  'committedWorkCount',(select committed_work_count from committed_work_coverage),
  'mappedCommittedWorkCount',(select mapped_committed_work_count from committed_work_coverage),
  'unmappedCommittedWorkCount',(select unmapped_committed_work_count from committed_work_coverage),
  'activeScanRows',(select count(*) from active_checks),
  'activeScanSequences',coalesce((select jsonb_agg(scan_sequence order by message_id) from active_checks),'[]'::jsonb),
  'activeSequenceConsistent',coalesce((select bool_and(
    scan_sequence is not null
    and productive_same_boundary_count=0
    and unknown_same_boundary_count=0
    and caught_up_same_boundary_count=completed_same_boundary_count
    and completed_same_boundary_count=scan_sequence
    and (
      (scan_sequence=0 and max_completed_same_boundary_sequence is null)
      or (scan_sequence>0 and max_completed_same_boundary_sequence=scan_sequence-1)
    )
  ) from active_checks),false)
)::text as state;`

if (!/^\s*with\b/iu.test(SQL) || /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu.test(SQL)) {
  fail('scan-sequence audit must be SELECT/read_only only')
}
if (/public\.xrpl_phase_(scan|commit|finalize)_message_id\s*\(/u.test(SQL)) {
  fail('scan-sequence audit must classify stored successor records, not invoke message-ID helpers')
}
if (!SQL.includes("r.successor_phase='commit'") || !SQL.includes("r.successor_phase='scan'")) {
  fail('scan-sequence audit must classify both productive and caught-up successors')
}
if (SQL.includes('left join lateral') || SQL.includes('from transport')) {
  fail('scan-sequence audit must not rescan a materialized transport union per completed scan')
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
  if (!raw) fail('query returned no state')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

const options = parse(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const outputDir = resolve(options['output-dir'] ?? 'r5-terminal-scan-sequence-readonly')
await mkdir(outputDir,{recursive:true})
const state = await query()

const historicalSequenceMappingProven =
  state.transportDuplicateMessageIds === 0
  && state.completedScanRows > 0
  && state.unknownScanRows === 0
  && state.invalidBoundaryChains === 0
  && state.orphanOpenCaughtUpOnlyBoundaries === 0
  && state.productiveMappingRows === state.productiveMappingDistinctWorks
  && state.unmappedCommittedWorkCount === 0
const activeSequenceCertificateProven =
  state.activeScanRows === 1
  && state.activeSequenceConsistent === true

const evidence = {
  schemaVersion:1,
  purpose:'r5-terminal-scan-sequence-readonly-audit',
  sourceCommit,
  ...state,
  classificationRule:{
    productive:'stored successor resolves uniquely to commit chunk 0 whose work matches the exact scan boundary',
    caughtUp:'stored successor resolves uniquely to scan at the same boundary with scanSequence exactly +1',
    workPresenceAloneIsNotProductiveEvidence:true,
    caughtUpOnlyBoundaryMustRemainBackedByActiveScan:true,
    successorResolution:'archive message_hash primary key plus live message_id primary key; no per-scan transport rescan',
  },
  historicalSequenceMappingProven,
  activeSequenceCertificateProven,
  proposedCertificateShape:{
    productiveSequenceField:'xrpl_phase_work.source_scan_sequence',
    activeSequenceField:'xrpl_phase_streams.next_scan_sequence',
    appendOnlyScanCertificateRowsRequired:false,
  },
  completedAtDerivability:{caughtUp:false,commit:false},
  resultDigestDerivabilityClaimed:false,
  productionDatabaseReadOnly:true,
  productionMutationAuthorized:false,
  archiveMutationAuthorized:false,
  phaseBMutationAuthorized:false,
  r5RearmAuthorized:false,
  mainnetAuthorized:false,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/scan-sequence.json`,serialized)
await writeFile(`${outputDir}/scan-sequence.sha256`,`${digest}\n`)

const summary=[
  '## Terminal scan-sequence read-only audit','',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${state.databaseBytes}\``,
  `- transport rows / duplicate message IDs: \`${state.transportRows} / ${state.transportDuplicateMessageIds}\``,
  `- completed scans archive / live / total: \`${state.archiveScanRows} / ${state.liveCompletedScanRows} / ${state.completedScanRows}\``,
  `- productive / caught-up / unknown scans: \`${state.productiveScanRows} / ${state.caughtUpScanRows} / ${state.unknownScanRows}\``,
  `- scan sequence min / max / nonzero rows: \`${state.scanSequenceMin} / ${state.scanSequenceMax} / ${state.scanSequenceNonzeroRows}\``,
  `- scan sequence histogram: \`${JSON.stringify(state.scanSequenceHistogram)}\``,
  `- boundary chains valid / invalid: \`${state.validBoundaryChains} / ${state.invalidBoundaryChains}\``,
  `- closed productive / open caught-up-only / orphan open: \`${state.closedProductiveBoundaries} / ${state.openCaughtUpOnlyBoundaries} / ${state.orphanOpenCaughtUpOnlyBoundaries}\``,
  `- productive mappings / distinct works: \`${state.productiveMappingRows} / ${state.productiveMappingDistinctWorks}\``,
  `- productive source sequence min / max / nonzero: \`${state.productiveSourceSequenceMin} / ${state.productiveSourceSequenceMax} / ${state.productiveSourceSequenceNonzeroRows}\``,
  `- productive mapping SHA-256: \`${state.productiveMappingDigest}\``,
  `- committed works mapped / unmapped: \`${state.mappedCommittedWorkCount} / ${state.unmappedCommittedWorkCount}\``,
  `- active scan rows / sequences / consistent: \`${state.activeScanRows} / ${JSON.stringify(state.activeScanSequences)} / ${state.activeSequenceConsistent}\``,
  `- historical sequence mapping proven: \`${historicalSequenceMappingProven}\``,
  `- active sequence certificate proven: \`${activeSequenceCertificateProven}\``,
  '',
  'Classification is successor-based. A durable work match by itself is not treated as productive-scan evidence.',
  'Successors are resolved through the archive message-hash primary key and live message-id primary key without rescanning a materialized transport union per scan.',
  'Safety: SELECT/read_only only. No schema/row/archive mutation, Phase B, cleanup, scheduler/deployment/public-reader change, R5 rearm, or Mainnet action is authorized.',
  `Evidence SHA-256: \`${digest}\``,'',
].join('\n')
await writeFile(`${outputDir}/scan-sequence-summary.md`,summary)
console.log(summary)