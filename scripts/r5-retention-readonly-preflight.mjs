#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function fail(message) {
  throw new Error(message)
}

function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  fail('Management API response contains no rows')
}

function findFirstKey(value, key) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstKey(entry, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key]
    for (const entry of Object.values(value)) {
      const found = findFirstKey(entry, key)
      if (found !== undefined) return found
    }
  }
  return undefined
}

async function managementQuery(query) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 2000) }
  }
  if (!response.ok) fail(`Supabase Management API read-only query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}

const SQL = String.raw`
with active_watermark as (
  select w.*
  from public.xrpl_phase_watermarks w
  where w.profile_id = 'supabase-devnet'
),
current_work as (
  select w.*
  from public.xrpl_phase_work w
  join active_watermark watermark on watermark.work_id = w.work_id
  where w.profile_id = 'supabase-devnet'
    and w.status = 'committed'
    and w.committed_at is not null
    and w.scanned_end_ledger_index = watermark.ledger_index
    and w.final_ledger_hash = watermark.ledger_hash
),
predecessor_work as (
  select predecessor.*
  from current_work current
  join public.xrpl_phase_work predecessor
    on predecessor.profile_id = current.profile_id
   and predecessor.status = 'committed'
   and predecessor.committed_at is not null
   and predecessor.scanned_end_ledger_index = current.previous_ledger_index
   and predecessor.final_ledger_hash = current.expected_parent_hash
  order by predecessor.committed_at desc, predecessor.work_id desc
  limit 1
),
protected_work as (
  select work_id from current_work
  union
  select work_id from predecessor_work
),
historical_work as (
  select w.*
  from public.xrpl_phase_work w
  where w.profile_id = 'supabase-devnet'
    and w.status = 'committed'
    and w.committed_at is not null
    and not exists (select 1 from protected_work p where p.work_id = w.work_id)
),
target_relations as (
  select unnest(array[
    'public.xrpl_phase_payload_chunks'::regclass,
    'public.xrpl_phase_commit_chunks'::regclass,
    'public.xrpl_phase_messages'::regclass,
    'public.xrpl_phase_successors'::regclass,
    'cron.job_run_details'::regclass
  ]) as oid
),
routine_dependencies as (
  select
    n.nspname as schema_name,
    p.proname as routine_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef as security_definer,
    position('xrpl_phase_payload_chunks' in lower(pg_get_functiondef(p.oid))) > 0 as mentions_payload_chunks,
    position('xrpl_phase_commit_chunks' in lower(pg_get_functiondef(p.oid))) > 0 as mentions_commit_chunks,
    position('xrpl_phase_messages' in lower(pg_get_functiondef(p.oid))) > 0 as mentions_messages,
    position('xrpl_phase_successors' in lower(pg_get_functiondef(p.oid))) > 0 as mentions_successors,
    position('cron.job_run_details' in lower(pg_get_functiondef(p.oid))) > 0 as mentions_cron_run_details
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and (
      position('xrpl_phase_payload_chunks' in lower(pg_get_functiondef(p.oid))) > 0
      or position('xrpl_phase_commit_chunks' in lower(pg_get_functiondef(p.oid))) > 0
      or position('xrpl_phase_messages' in lower(pg_get_functiondef(p.oid))) > 0
      or position('xrpl_phase_successors' in lower(pg_get_functiondef(p.oid))) > 0
      or position('cron.job_run_details' in lower(pg_get_functiondef(p.oid))) > 0
    )
),
view_dependencies as (
  select
    schemaname as schema_name,
    viewname as view_name,
    position('xrpl_phase_payload_chunks' in lower(definition)) > 0 as mentions_payload_chunks,
    position('xrpl_phase_commit_chunks' in lower(definition)) > 0 as mentions_commit_chunks,
    position('xrpl_phase_messages' in lower(definition)) > 0 as mentions_messages,
    position('xrpl_phase_successors' in lower(definition)) > 0 as mentions_successors,
    position('cron.job_run_details' in lower(definition)) > 0 as mentions_cron_run_details
  from pg_views
  where schemaname not in ('pg_catalog', 'information_schema')
    and (
      position('xrpl_phase_payload_chunks' in lower(definition)) > 0
      or position('xrpl_phase_commit_chunks' in lower(definition)) > 0
      or position('xrpl_phase_messages' in lower(definition)) > 0
      or position('xrpl_phase_successors' in lower(definition)) > 0
      or position('cron.job_run_details' in lower(definition)) > 0
    )
)
select jsonb_build_object(
  'databaseBytes', pg_database_size(current_database())::bigint,
  'databaseHaltBytes', 400000000::bigint,
  'databaseHeadroomBytes', 400000000::bigint - pg_database_size(current_database())::bigint,
  'capturedAt', now(),
  'activeBoundary', jsonb_build_object(
    'watermarkWorkId', (select work_id from active_watermark),
    'watermarkLedgerIndex', (select ledger_index from active_watermark),
    'currentWorkId', (select work_id from current_work),
    'currentCommittedAt', (select committed_at from current_work),
    'predecessorWorkId', (select work_id from predecessor_work),
    'predecessorCommittedAt', (select committed_at from predecessor_work),
    'protectedWorkCount', (select count(*)::bigint from protected_work)
  ),
  'cronRunDetails', jsonb_build_object(
    'exactRows', (select count(*)::bigint from cron.job_run_details),
    'totalBytes', pg_total_relation_size('cron.job_run_details'::regclass)::bigint,
    'heapBytes', pg_relation_size('cron.job_run_details'::regclass)::bigint,
    'indexBytes', pg_indexes_size('cron.job_run_details'::regclass)::bigint,
    'oldestStartTime', (select min(start_time) from cron.job_run_details),
    'newestStartTime', (select max(start_time) from cron.job_run_details),
    'rowsLast1h', (select count(*)::bigint from cron.job_run_details where start_time >= now() - interval '1 hour'),
    'rowsLast6h', (select count(*)::bigint from cron.job_run_details where start_time >= now() - interval '6 hours'),
    'rowsLast24h', (select count(*)::bigint from cron.job_run_details where start_time >= now() - interval '24 hours'),
    'rowsOlder6h', (select count(*)::bigint from cron.job_run_details where start_time < now() - interval '6 hours'),
    'logicalBytesOlder6h', (select coalesce(sum(pg_column_size(r)), 0)::bigint from cron.job_run_details r where start_time < now() - interval '6 hours'),
    'rowsOlder24h', (select count(*)::bigint from cron.job_run_details where start_time < now() - interval '24 hours'),
    'logicalBytesOlder24h', (select coalesce(sum(pg_column_size(r)), 0)::bigint from cron.job_run_details r where start_time < now() - interval '24 hours'),
    'rowsOlder3d', (select count(*)::bigint from cron.job_run_details where start_time < now() - interval '3 days'),
    'logicalBytesOlder3d', (select coalesce(sum(pg_column_size(r)), 0)::bigint from cron.job_run_details r where start_time < now() - interval '3 days'),
    'rowsOlder7d', (select count(*)::bigint from cron.job_run_details where start_time < now() - interval '7 days'),
    'logicalBytesOlder7d', (select coalesce(sum(pg_column_size(r)), 0)::bigint from cron.job_run_details r where start_time < now() - interval '7 days'),
    'statusCounts', (select coalesce(jsonb_object_agg(status, count_value), '{}'::jsonb) from (select coalesce(status, '<null>') as status, count(*)::bigint as count_value from cron.job_run_details group by status) s),
    'constraints', (select coalesce(jsonb_agg(jsonb_build_object('name', conname, 'type', contype, 'definition', pg_get_constraintdef(oid, true)) order by conname), '[]'::jsonb) from pg_constraint where conrelid = 'cron.job_run_details'::regclass or confrelid = 'cron.job_run_details'::regclass),
    'userTriggers', (select coalesce(jsonb_agg(jsonb_build_object('name', tgname, 'definition', pg_get_triggerdef(oid, true)) order by tgname), '[]'::jsonb) from pg_trigger where tgrelid = 'cron.job_run_details'::regclass and not tgisinternal),
    'indexes', (select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'bytes', pg_relation_size(i.indexrelid), 'definition', pg_get_indexdef(i.indexrelid)) order by pg_relation_size(i.indexrelid) desc, c.relname), '[]'::jsonb) from pg_index i join pg_class c on c.oid = i.indexrelid where i.indrelid = 'cron.job_run_details'::regclass),
    'stats', (select coalesce(jsonb_build_object('estimatedLiveRows', n_live_tup, 'estimatedDeadRows', n_dead_tup, 'lastVacuum', last_vacuum, 'lastAutovacuum', last_autovacuum, 'vacuumCount', vacuum_count, 'autovacuumCount', autovacuum_count), '{}'::jsonb) from pg_stat_all_tables where relid = 'cron.job_run_details'::regclass)
  ),
  'payloadEvidence', jsonb_build_object(
    'totalRows', (select count(*)::bigint from public.xrpl_phase_payload_chunks),
    'totalRelationBytes', pg_total_relation_size('public.xrpl_phase_payload_chunks'::regclass)::bigint,
    'historicalRows', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id),
    'historicalLogicalBytes', (select coalesce(sum(pg_column_size(p)), 0)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id),
    'protectedRows', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join protected_work w on w.work_id = p.work_id),
    'rowsHistoricalOlder1h', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '1 hour'),
    'logicalBytesHistoricalOlder1h', (select coalesce(sum(pg_column_size(p)), 0)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '1 hour'),
    'rowsHistoricalOlder6h', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '6 hours'),
    'logicalBytesHistoricalOlder6h', (select coalesce(sum(pg_column_size(p)), 0)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '6 hours'),
    'rowsHistoricalOlder24h', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '24 hours'),
    'logicalBytesHistoricalOlder24h', (select coalesce(sum(pg_column_size(p)), 0)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '24 hours'),
    'rowsHistoricalOlder3d', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '3 days'),
    'logicalBytesHistoricalOlder3d', (select coalesce(sum(pg_column_size(p)), 0)::bigint from public.xrpl_phase_payload_chunks p join historical_work w on w.work_id = p.work_id where w.committed_at < now() - interval '3 days'),
    'rowsCommittedLast1h', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join public.xrpl_phase_work w on w.work_id = p.work_id where w.profile_id = 'supabase-devnet' and w.status = 'committed' and w.committed_at >= now() - interval '1 hour'),
    'rowsCommittedLast6h', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join public.xrpl_phase_work w on w.work_id = p.work_id where w.profile_id = 'supabase-devnet' and w.status = 'committed' and w.committed_at >= now() - interval '6 hours'),
    'rowsCommittedLast24h', (select count(*)::bigint from public.xrpl_phase_payload_chunks p join public.xrpl_phase_work w on w.work_id = p.work_id where w.profile_id = 'supabase-devnet' and w.status = 'committed' and w.committed_at >= now() - interval '24 hours'),
    'stats', (select coalesce(jsonb_build_object('estimatedLiveRows', n_live_tup, 'estimatedDeadRows', n_dead_tup, 'lastVacuum', last_vacuum, 'lastAutovacuum', last_autovacuum, 'vacuumCount', vacuum_count, 'autovacuumCount', autovacuum_count), '{}'::jsonb) from pg_stat_user_tables where relid = 'public.xrpl_phase_payload_chunks'::regclass)
  ),
  'commitEvidence', jsonb_build_object(
    'totalRows', (select count(*)::bigint from public.xrpl_phase_commit_chunks),
    'totalRelationBytes', pg_total_relation_size('public.xrpl_phase_commit_chunks'::regclass)::bigint,
    'historicalCompletedRows', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed'),
    'historicalCompletedLogicalBytes', (select coalesce(sum(pg_column_size(c)), 0)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed'),
    'protectedRows', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join protected_work w on w.work_id = c.work_id),
    'rowsHistoricalOlder1h', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '1 hour'),
    'logicalBytesHistoricalOlder1h', (select coalesce(sum(pg_column_size(c)), 0)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '1 hour'),
    'rowsHistoricalOlder6h', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '6 hours'),
    'logicalBytesHistoricalOlder6h', (select coalesce(sum(pg_column_size(c)), 0)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '6 hours'),
    'rowsHistoricalOlder24h', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '24 hours'),
    'logicalBytesHistoricalOlder24h', (select coalesce(sum(pg_column_size(c)), 0)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '24 hours'),
    'rowsHistoricalOlder3d', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '3 days'),
    'logicalBytesHistoricalOlder3d', (select coalesce(sum(pg_column_size(c)), 0)::bigint from public.xrpl_phase_commit_chunks c join historical_work w on w.work_id = c.work_id where c.status = 'completed' and w.committed_at < now() - interval '3 days'),
    'rowsCommittedLast1h', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join public.xrpl_phase_work w on w.work_id = c.work_id where w.profile_id = 'supabase-devnet' and w.status = 'committed' and w.committed_at >= now() - interval '1 hour'),
    'rowsCommittedLast6h', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join public.xrpl_phase_work w on w.work_id = c.work_id where w.profile_id = 'supabase-devnet' and w.status = 'committed' and w.committed_at >= now() - interval '6 hours'),
    'rowsCommittedLast24h', (select count(*)::bigint from public.xrpl_phase_commit_chunks c join public.xrpl_phase_work w on w.work_id = c.work_id where w.profile_id = 'supabase-devnet' and w.status = 'committed' and w.committed_at >= now() - interval '24 hours'),
    'statusCounts', (select coalesce(jsonb_object_agg(status, count_value), '{}'::jsonb) from (select status, count(*)::bigint as count_value from public.xrpl_phase_commit_chunks group by status) s),
    'stats', (select coalesce(jsonb_build_object('estimatedLiveRows', n_live_tup, 'estimatedDeadRows', n_dead_tup, 'lastVacuum', last_vacuum, 'lastAutovacuum', last_autovacuum, 'vacuumCount', vacuum_count, 'autovacuumCount', autovacuum_count), '{}'::jsonb) from pg_stat_user_tables where relid = 'public.xrpl_phase_commit_chunks'::regclass)
  ),
  'workRate', jsonb_build_object(
    'committedWorkRowsTotal', (select count(*)::bigint from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'committed' and committed_at is not null),
    'committedWorkRowsLast1h', (select count(*)::bigint from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'committed' and committed_at >= now() - interval '1 hour'),
    'committedWorkRowsLast6h', (select count(*)::bigint from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'committed' and committed_at >= now() - interval '6 hours'),
    'committedWorkRowsLast24h', (select count(*)::bigint from public.xrpl_phase_work where profile_id = 'supabase-devnet' and status = 'committed' and committed_at >= now() - interval '24 hours'),
    'historicalWorkRows', (select count(*)::bigint from historical_work),
    'historicalWorkOlder1h', (select count(*)::bigint from historical_work where committed_at < now() - interval '1 hour'),
    'historicalWorkOlder6h', (select count(*)::bigint from historical_work where committed_at < now() - interval '6 hours'),
    'historicalWorkOlder24h', (select count(*)::bigint from historical_work where committed_at < now() - interval '24 hours')
  ),
  'foreignKeys', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', conname,
      'definedOn', conrelid::regclass::text,
      'references', nullif(confrelid, 0)::regclass::text,
      'deleteAction', confdeltype,
      'definition', pg_get_constraintdef(oid, true)
    ) order by conrelid::regclass::text, conname), '[]'::jsonb)
    from pg_constraint
    where contype = 'f'
      and (conrelid in (select oid from target_relations) or confrelid in (select oid from target_relations))
  ),
  'userTriggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tgrelid::regclass::text,
      'name', tgname,
      'definition', pg_get_triggerdef(oid, true)
    ) order by tgrelid::regclass::text, tgname), '[]'::jsonb)
    from pg_trigger
    where tgrelid in (select oid from target_relations)
      and not tgisinternal
  ),
  'routineDependencies', (
    select coalesce(jsonb_agg(to_jsonb(r) order by schema_name, routine_name, identity_arguments), '[]'::jsonb)
    from routine_dependencies r
  ),
  'viewDependencies', (
    select coalesce(jsonb_agg(to_jsonb(v) order by schema_name, view_name), '[]'::jsonb)
    from view_dependencies v
  ),
  'storageMechanics', jsonb_build_object(
    'autovacuumSetting', current_setting('autovacuum', true),
    'trackCountsSetting', current_setting('track_counts', true),
    'installedPgstattuple', exists(select 1 from pg_extension where extname = 'pgstattuple'),
    'installedPgFreespacemap', exists(select 1 from pg_extension where extname = 'pg_freespacemap')
  ),
  'retentionBoundary', jsonb_build_object(
    'probeReadOnly', true,
    'currentAndPredecessorProtected', true,
    'canonicalReferenceRowsUntouched', true,
    'committedWorkRowsUntouched', true,
    'schedulerMessagesUntouched', true,
    'successorEdgesUntouched', true,
    'noDeleteAuthorized', true,
    'noVacuumAuthorized', true,
    'noSchedulerMutationAuthorized', true,
    'noDeploymentAuthorized', true,
    'mainnetDisabled', true,
    'noStabilizationSoakOrRestartAuthorized', true
  )
) as state;
`.trim()

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) fail(`unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = argv[index + 1]
    if (value == null || value.startsWith('--')) fail(`missing value for --${key}`)
    options[key] = value
    index += 1
  }
  return options
}

async function writeText(path, text) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, text)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function renderSummary(state, sourceCommit) {
  const cron = state.cronRunDetails ?? {}
  const payload = state.payloadEvidence ?? {}
  const commit = state.commitEvidence ?? {}
  const boundary = state.activeBoundary ?? {}
  const routineCount = Array.isArray(state.routineDependencies) ? state.routineDependencies.length : 0
  const viewCount = Array.isArray(state.viewDependencies) ? state.viewDependencies.length : 0
  const fkCount = Array.isArray(state.foreignKeys) ? state.foreignKeys.length : 0
  const triggerCount = Array.isArray(state.userTriggers) ? state.userTriggers.length : 0
  const mechanics = state.storageMechanics ?? {}
  const lines = [
    '## R5 retention read-only preflight',
    '',
    `Source main commit: \`${sourceCommit}\``,
    `Database bytes/headroom to internal 400,000,000-byte halt: \`${state.databaseBytes} / ${state.databaseHeadroomBytes}\``,
    `Current/predecessor work: \`${boundary.currentWorkId ?? 'none'} / ${boundary.predecessorWorkId ?? 'none'}\``,
    '',
    '### Cron run history',
    `- rows / total bytes: \`${cron.exactRows} / ${cron.totalBytes}\``,
    `- rows last 1h / 6h / 24h: \`${cron.rowsLast1h} / ${cron.rowsLast6h} / ${cron.rowsLast24h}\``,
    `- rows older 6h / 24h / 3d / 7d: \`${cron.rowsOlder6h} / ${cron.rowsOlder24h} / ${cron.rowsOlder3d} / ${cron.rowsOlder7d}\``,
    `- logical bytes older 6h / 24h / 3d / 7d: \`${cron.logicalBytesOlder6h} / ${cron.logicalBytesOlder24h} / ${cron.logicalBytesOlder3d} / ${cron.logicalBytesOlder7d}\``,
    '',
    '### Historical raw phase evidence',
    `- payload rows / relation bytes: \`${payload.totalRows} / ${payload.totalRelationBytes}\``,
    `- payload historical rows/logical bytes: \`${payload.historicalRows} / ${payload.historicalLogicalBytes}\``,
    `- payload older 1h / 6h / 24h rows: \`${payload.rowsHistoricalOlder1h} / ${payload.rowsHistoricalOlder6h} / ${payload.rowsHistoricalOlder24h}\``,
    `- payload older 1h / 6h / 24h logical bytes: \`${payload.logicalBytesHistoricalOlder1h} / ${payload.logicalBytesHistoricalOlder6h} / ${payload.logicalBytesHistoricalOlder24h}\``,
    `- commit rows / relation bytes: \`${commit.totalRows} / ${commit.totalRelationBytes}\``,
    `- completed historical commit rows/logical bytes: \`${commit.historicalCompletedRows} / ${commit.historicalCompletedLogicalBytes}\``,
    `- commit older 1h / 6h / 24h rows: \`${commit.rowsHistoricalOlder1h} / ${commit.rowsHistoricalOlder6h} / ${commit.rowsHistoricalOlder24h}\``,
    `- commit older 1h / 6h / 24h logical bytes: \`${commit.logicalBytesHistoricalOlder1h} / ${commit.logicalBytesHistoricalOlder6h} / ${commit.logicalBytesHistoricalOlder24h}\``,
    '',
    '### Dependency/storage checks',
    `- relevant foreign keys / user triggers: \`${fkCount} / ${triggerCount}\``,
    `- routines / views mentioning candidate tables: \`${routineCount} / ${viewCount}\``,
    `- autovacuum / pgstattuple / pg_freespacemap: \`${mechanics.autovacuumSetting ?? 'unknown'} / ${mechanics.installedPgstattuple ?? false} / ${mechanics.installedPgFreespacemap ?? false}\``,
    '',
    'This run is measurement only. It does not authorize DELETE, VACUUM, scheduler mutation, deployment, Mainnet, stabilization, soak, or R5 restart. Canonical reference rows, committed work rows, scheduler messages, and successor edges are outside this probe’s reclaim authority.',
  ]

  const cron24 = number(cron.rowsLast24h)
  const payload24 = number(payload.rowsCommittedLast24h)
  const commit24 = number(commit.rowsCommittedLast24h)
  lines.push('', `Observed 24h row production snapshot: cron \`${cron24}\`, payload chunks \`${payload24}\`, commit chunks \`${commit24}\`.`)
  return `${lines.join('\n')}\n`
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const rows = await managementQuery(SQL)
const rawState = findFirstKey(rows, 'state')
const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState
if (!state || typeof state !== 'object' || Array.isArray(state)) fail('retention preflight state missing')
if (state.retentionBoundary?.probeReadOnly !== true || state.retentionBoundary?.noDeleteAuthorized !== true) {
  fail('retention preflight safety boundary missing')
}

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-retention-readonly-preflight',
  sourceCommit,
  ...state,
}
await writeText(options.output, `${JSON.stringify(evidence, null, 2)}\n`)
await writeText(options.summary, renderSummary(evidence, sourceCommit))
process.stdout.write(`${JSON.stringify(evidence)}\n`)
