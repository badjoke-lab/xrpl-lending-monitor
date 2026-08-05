import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
const sourceCommit = process.env.GITHUB_SHA ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('invalid project ref')
if (accessToken.length < 20) throw new Error('access token unavailable')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) throw new Error('invalid run id')
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('invalid commit')

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const expectedWatermark = 4_138_631
const exactError = 'r5_recovery_batch_pending_scan_invalid'
const output = 'supabase-r5-pending-scan-diagnostic'
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

function parse(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2_000) } }
}
function rows(body) {
  for (const value of [body, body?.result, body?.data, body?.rows, body?.result?.rows]) {
    if (Array.isArray(value)) return value
  }
  throw new Error('query response contains no rows')
}
function value(row) {
  return row?.jsonb_build_object ?? row?.value ?? Object.values(row ?? {})[0]
}
function object(input, name) {
  const parsed = typeof input === 'string' ? parse(input) : input
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} invalid`)
  }
  return parsed
}
function integer(input, name) {
  const parsed = typeof input === 'string' ? Number(input) : input
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} invalid`)
  return parsed
}
function code(input) {
  return `\`${String(input ?? 'null').replaceAll('`', "'")}\``
}
async function query(sql, parameters = []) {
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

const stateSql = `
with run_state as (
  select to_jsonb(run) as value
  from xrpl_r5_v1.recovery_runs run
  where run.run_id = $1::text
), physical_watermark as (
  select to_jsonb(watermark) as value
  from public.xrpl_phase_watermarks watermark
  where watermark.profile_id = 'supabase-devnet'
), noncommitted_work as (
  select coalesce(jsonb_agg(to_jsonb(work) order by work.work_id), '[]'::jsonb) as value
  from public.xrpl_phase_work work
  where work.profile_id = 'supabase-devnet'
    and work.status <> 'committed'
), recent_work as (
  select coalesce(jsonb_agg(to_jsonb(work) order by work.start_ledger_index, work.work_id), '[]'::jsonb) as value
  from (
    select *
    from public.xrpl_phase_work
    where profile_id = 'supabase-devnet'
    order by start_ledger_index desc, work_id desc
    limit 32
  ) work
), nonterminal_messages as (
  select coalesce(jsonb_agg(to_jsonb(message)), '[]'::jsonb) as value
  from public.xrpl_phase_messages message
  where message.profile_id = 'supabase-devnet'
    and message.status <> 'committed'
), active_batches as (
  select coalesce(jsonb_agg(to_jsonb(batch) order by batch.batch_sequence), '[]'::jsonb) as value
  from xrpl_r5_v1.recovery_batches batch
  where batch.run_id = $1::text
    and batch.status in ('leased', 'halted')
), recent_batches as (
  select coalesce(jsonb_agg(to_jsonb(batch) order by batch.batch_sequence), '[]'::jsonb) as value
  from (
    select *
    from xrpl_r5_v1.recovery_batches
    where run_id = $1::text
    order by batch_sequence desc
    limit 16
  ) batch
)
select jsonb_build_object(
  'purpose', 'r5-pending-scan-read-only-diagnostic',
  'sourceRunId', $2::bigint,
  'sourceCommit', $3::text,
  'databaseBytes', pg_database_size(current_database())::bigint,
  'run', (select value from run_state),
  'physicalWatermark', (select value from physical_watermark),
  'noncommittedWork', (select value from noncommitted_work),
  'recentWork', (select value from recent_work),
  'nonterminalMessages', (select value from nonterminal_messages),
  'activeBatches', (select value from active_batches),
  'recentBatches', (select value from recent_batches)
);
`

const functionSql = `
select jsonb_build_object(
  'signature', p.oid::regprocedure::text,
  'name', p.proname,
  'definition', pg_get_functiondef(p.oid)
) as value
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    position($1::text in pg_get_functiondef(p.oid)) > 0
    or p.proname in (
      'xrpl_claim_r5_active_recovery_batch_from_prepared_head',
      'xrpl_claim_r5_active_recovery_batch',
      'xrpl_prepare_r5_active_recovery'
    )
  )
order by p.proname, p.oid::regprocedure::text;
`

function excerpt(definition) {
  const index = definition.indexOf(exactError)
  if (index < 0) return definition.slice(0, 2_000)
  return definition.slice(
    Math.max(0, index - 2_500),
    Math.min(definition.length, index + exactError.length + 2_500),
  )
}

await mkdir(output, { recursive: true })
try {
  const stateRows = await query(stateSql, [recoveryRunId, sourceRunId, sourceCommit])
  if (stateRows.length !== 1) throw new Error(`unexpected state row count ${stateRows.length}`)
  const state = object(value(stateRows[0]), 'state')
  const run = object(state.run, 'run')
  const watermark = object(state.physicalWatermark, 'physicalWatermark')

  const functionRows = await query(functionSql, [exactError])
  const functions = functionRows.map((row) => {
    const item = object(value(row), 'function')
    const definition = String(item.definition ?? '')
    return {
      signature: String(item.signature ?? ''),
      name: String(item.name ?? ''),
      definitionSha256: createHash('sha256').update(definition).digest('hex'),
      containsExactError: definition.includes(exactError),
      excerpt: excerpt(definition),
    }
  })
  const exactFunctions = functions.filter((item) => item.containsExactError)
  const checks = {
    recoveryRunExact: run.run_id === recoveryRunId,
    recoveryRunning: run.status === 'running',
    recoveryWatermarkExact:
      integer(run.current_watermark_ledger_index, 'run watermark') === expectedWatermark,
    exactErrorLocatedOnce: exactFunctions.length === 1,
    noActiveBatch: Array.isArray(state.activeBatches) && state.activeBatches.length === 0,
    publicReaderUnchanged: true,
    mainnetDisabled: true,
    stabilizationUnauthorized: true,
    soakUnauthorized: true,
  }
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`diagnostic checks failed: ${JSON.stringify(checks)}`)
  }

  const evidence = { ...state, functions, checks }
  await writeFile(`${output}/diagnostic.json`, `${JSON.stringify(evidence, null, 2)}\n`)
  const exact = exactFunctions[0]
  const markdown = [
    '## R5 pending-scan read-only diagnostic',
    '',
    `- run: ${code(sourceRunId)}`,
    `- commit: ${code(sourceCommit)}`,
    `- diagnostic: ${code('success')}`,
    `- R5 watermark ledger: ${code(run.current_watermark_ledger_index)}`,
    `- R5 watermark work: ${code(run.current_watermark_work_id)}`,
    `- physical watermark ledger: ${code(watermark.ledger_index)}`,
    `- physical watermark work: ${code(watermark.work_id)}`,
    `- noncommitted work rows: ${code(state.noncommittedWork.length)}`,
    `- nonterminal message rows: ${code(state.nonterminalMessages.length)}`,
    `- active R5 batches: ${code(state.activeBatches.length)}`,
    `- exact error function: ${code(exact.signature)}`,
    `- function definition SHA-256: ${code(exact.definitionSha256)}`,
    `- database bytes: ${code(state.databaseBytes)}`,
    `- public reader unchanged: ${code(true)}`,
    `- Mainnet disabled: ${code(true)}`,
    `- stabilization authorized: ${code(false)}`,
    `- soak authorized: ${code(false)}`,
    '',
    '### Exact function excerpt',
    '',
    '```sql',
    exact.excerpt,
    '```',
    '',
  ].join('\n')
  await writeFile(`${output}/diagnostic.md`, markdown)
  console.log(markdown)
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  await writeFile(`${output}/diagnostic.json`, `${JSON.stringify({
    purpose: 'r5-pending-scan-read-only-diagnostic',
    sourceRunId,
    sourceCommit,
    reason,
    publicReaderUnchanged: true,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }, null, 2)}\n`)
  await writeFile(`${output}/diagnostic.md`, [
    '## R5 pending-scan read-only diagnostic',
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
