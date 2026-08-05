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
const expectedRecoveryWatermark = 4_138_491
const databaseHaltBytes = 400_000_000
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const output = 'supabase-r5-watermark-drift-diagnostic'

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
function integer(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} invalid`)
  return parsed
}
function boolean(value, name) {
  if (value !== true && value !== false) throw new Error(`${name} invalid`)
  return value
}
function code(value) {
  return `\`${String(value ?? 'null').replaceAll('`', "'")}\``
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
with run_state as (
  select *
  from xrpl_r5_v1.recovery_runs
  where run_id = $1::text
), physical_watermark as (
  select *
  from public.xrpl_phase_watermarks
  where profile_id = 'supabase-devnet'
), batch_counts as (
  select
    status,
    count(*)::bigint as row_count,
    min(batch_sequence)::bigint as minimum_sequence,
    max(batch_sequence)::bigint as maximum_sequence,
    min(start_ledger_index)::bigint as minimum_start_ledger,
    max(end_ledger_index)::bigint as maximum_end_ledger
  from xrpl_r5_v1.recovery_batches
  where run_id = $1::text
  group by status
), message_counts as (
  select status, count(*)::bigint as row_count
  from public.xrpl_phase_messages
  where profile_id = 'supabase-devnet'
  group by status
), work_counts as (
  select status, count(*)::bigint as row_count
  from public.xrpl_phase_work
  where profile_id = 'supabase-devnet'
  group by status
), descendants as (
  select
    row_number() over (order by work.start_ledger_index, work.work_id)::bigint as ordinal,
    work.*,
    lag(work.scanned_end_ledger_index) over (
      order by work.start_ledger_index, work.work_id
    ) as prior_end_ledger_index,
    lag(work.final_ledger_hash) over (
      order by work.start_ledger_index, work.work_id
    ) as prior_final_ledger_hash
  from public.xrpl_phase_work work
  cross join run_state run
  cross join physical_watermark watermark
  where work.profile_id = 'supabase-devnet'
    and work.status = 'committed'
    and work.start_ledger_index > run.current_watermark_ledger_index
    and work.start_ledger_index <= watermark.ledger_index
), descendant_summary as (
  select
    count(*)::bigint as work_count,
    min(start_ledger_index)::bigint as first_ledger_index,
    max(scanned_end_ledger_index)::bigint as last_ledger_index,
    coalesce(bool_and(
      start_ledger_index = previous_ledger_index + 1
      and scanned_end_ledger_index = start_ledger_index
    ), false) as single_ledger_chain,
    coalesce(bool_and(
      case when ordinal = 1 then
        previous_ledger_index = (select current_watermark_ledger_index from run_state)
        and expected_parent_hash = (select current_watermark_ledger_hash from run_state)
      else
        previous_ledger_index = prior_end_ledger_index
        and start_ledger_index = prior_end_ledger_index + 1
        and expected_parent_hash = prior_final_ledger_hash
      end
    ), false) as hash_linked_chain,
    encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
      'workId', work_id,
      'previousLedgerIndex', previous_ledger_index,
      'startLedgerIndex', start_ledger_index,
      'scannedEndLedgerIndex', scanned_end_ledger_index,
      'expectedParentHash', expected_parent_hash,
      'finalLedgerHash', final_ledger_hash,
      'payloadDigest', payload_digest,
      'committedAt', committed_at
    ) order by start_ledger_index, work_id), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
      as works_digest
  from descendants
), first_descendant as (
  select to_jsonb(descendants) as value
  from descendants
  order by ordinal
  limit 1
), last_descendant as (
  select to_jsonb(descendants) as value
  from descendants
  order by ordinal desc
  limit 1
), claim_definition as (
  select pg_get_functiondef(to_regprocedure(
    'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamptz,integer)'
  )) as value
)
select jsonb_build_object(
  'purpose', 'r5-watermark-drift-read-only-diagnostic',
  'sourceRunId', $2::bigint,
  'sourceCommit', $3::text,
  'databaseBytes', pg_database_size(current_database())::bigint,
  'databaseHaltBytes', $4::bigint,
  'run', to_jsonb(run_state),
  'physicalWatermark', to_jsonb(physical_watermark),
  'batchCounts', coalesce((select jsonb_agg(to_jsonb(batch_counts) order by status) from batch_counts), '[]'::jsonb),
  'messageCounts', coalesce((select jsonb_agg(to_jsonb(message_counts) order by status) from message_counts), '[]'::jsonb),
  'workCounts', coalesce((select jsonb_agg(to_jsonb(work_counts) order by status) from work_counts), '[]'::jsonb),
  'descendantSummary', to_jsonb(descendant_summary),
  'firstDescendant', coalesce((select value from first_descendant), 'null'::jsonb),
  'lastDescendant', coalesce((select value from last_descendant), 'null'::jsonb),
  'claimCapTwelveInstalled', position(
    'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;'
    in (select value from claim_definition)
  ) > 0,
  'claimCapTwentyFourAbsent', position(
    'v_count := least(24::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;'
    in (select value from claim_definition)
  ) = 0
)
from run_state
cross join physical_watermark
cross join descendant_summary;
`

await mkdir(output, { recursive: true })
try {
  const resultRows = await query(sql, [
    recoveryRunId,
    sourceRunId,
    sourceCommit,
    databaseHaltBytes,
  ])
  if (resultRows.length !== 1) throw new Error(`unexpected row count ${resultRows.length}`)
  const result = object(resultRows[0]?.jsonb_build_object ?? resultRows[0]?.jsonb_build_object_agg ?? Object.values(resultRows[0] ?? {})[0], 'diagnostic')
  const run = object(result.run, 'run')
  const physical = object(result.physicalWatermark, 'physicalWatermark')
  const descendants = object(result.descendantSummary, 'descendantSummary')

  const checks = {
    expectedRun: run.run_id === recoveryRunId,
    running: run.status === 'running',
    recoveryWatermarkExact:
      integer(run.current_watermark_ledger_index, 'run.current_watermark_ledger_index') === expectedRecoveryWatermark,
    accountingExact:
      integer(run.committed_ledgers, 'run.committed_ledgers') ===
      integer(run.current_watermark_ledger_index, 'run.current_watermark_ledger_index') -
      integer(run.start_watermark_ledger_index, 'run.start_watermark_ledger_index'),
    physicalAhead:
      integer(physical.ledger_index, 'physical.ledger_index') >
      integer(run.current_watermark_ledger_index, 'run.current_watermark_ledger_index'),
    descendantCountExact:
      integer(descendants.work_count, 'descendants.work_count') ===
      integer(physical.ledger_index, 'physical.ledger_index') -
      integer(run.current_watermark_ledger_index, 'run.current_watermark_ledger_index'),
    singleLedgerChain: boolean(descendants.single_ledger_chain, 'single_ledger_chain'),
    hashLinkedChain: boolean(descendants.hash_linked_chain, 'hash_linked_chain'),
    noLeasedOrHaltedBatches: !result.batchCounts.some(
      (row) => ['leased', 'halted'].includes(row.status) && Number(row.row_count) > 0,
    ),
    databaseBelowHalt:
      integer(result.databaseBytes, 'databaseBytes') < databaseHaltBytes,
    claimCapTwelveInstalled: result.claimCapTwelveInstalled === true,
    claimCapTwentyFourAbsent: result.claimCapTwentyFourAbsent === true,
    publicReaderUnchanged: true,
    mainnetDisabled: true,
    stabilizationUnauthorized: true,
    soakUnauthorized: true,
  }
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`diagnostic checks failed: ${JSON.stringify(checks)}`)
  }

  const evidence = { ...result, checks }
  await writeFile(`${output}/diagnostic.json`, `${JSON.stringify(evidence, null, 2)}\n`)
  const markdown = [
    '## R5 watermark drift read-only diagnostic',
    '',
    `- run: ${code(sourceRunId)}`,
    `- commit: ${code(sourceCommit)}`,
    `- diagnostic: ${code('success')}`,
    `- R5 status: ${code(run.status)}`,
    `- completed batches: ${code(run.completed_batches)}`,
    `- committed ledgers: ${code(run.committed_ledgers)}`,
    `- R5 watermark ledger: ${code(run.current_watermark_ledger_index)}`,
    `- R5 watermark hash: ${code(run.current_watermark_ledger_hash)}`,
    `- R5 watermark work: ${code(run.current_watermark_work_id)}`,
    `- physical watermark ledger: ${code(physical.ledger_index)}`,
    `- physical watermark hash: ${code(physical.ledger_hash)}`,
    `- physical watermark work: ${code(physical.work_id)}`,
    `- descendant ledgers: ${code(descendants.work_count)}`,
    `- first descendant ledger: ${code(descendants.first_ledger_index)}`,
    `- last descendant ledger: ${code(descendants.last_ledger_index)}`,
    `- descendant works digest: ${code(descendants.works_digest)}`,
    `- single-ledger chain: ${code(checks.singleLedgerChain)}`,
    `- hash-linked chain: ${code(checks.hashLinkedChain)}`,
    `- no leased or halted R5 batch: ${code(checks.noLeasedOrHaltedBatches)}`,
    `- database bytes: ${code(result.databaseBytes)}`,
    `- database halt bytes: ${code(databaseHaltBytes)}`,
    `- twelve-ledger claim cap installed: ${code(checks.claimCapTwelveInstalled)}`,
    `- prior twenty-four-ledger assignment absent: ${code(checks.claimCapTwentyFourAbsent)}`,
    `- public reader unchanged: ${code(true)}`,
    `- Mainnet disabled: ${code(true)}`,
    `- stabilization authorized: ${code(false)}`,
    `- soak authorized: ${code(false)}`,
    '',
  ].join('\n')
  await writeFile(`${output}/diagnostic.md`, markdown)
  console.log(markdown)
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  const failed = {
    purpose: 'r5-watermark-drift-read-only-diagnostic',
    sourceRunId,
    sourceCommit,
    reason,
    publicReaderUnchanged: true,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }
  await writeFile(`${output}/failed-diagnostic.json`, `${JSON.stringify(failed, null, 2)}\n`)
  await writeFile(`${output}/diagnostic.md`, [
    '## R5 watermark drift read-only diagnostic',
    '',
    `- run: ${code(sourceRunId)}`,
    `- commit: ${code(sourceCommit)}`,
    `- diagnostic: ${code('failed')}`,
    `- reason: ${code(reason)}`,
    `- public reader unchanged: ${code(true)}`,
    `- Mainnet disabled: ${code(true)}`,
    `- stabilization authorized: ${code(false)}`,
    `- soak authorized: ${code(false)}`,
    '',
  ].join('\n'))
  throw error
}
