#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const INTERNAL_DB_HALT = 400_000_000
const PROFILE_ID = 'supabase-devnet'
const MINIMUM_AGE_HOURS = 24
const TRANCHE_LIMIT = 250
const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000
const CLAIM_SIGNATURE = 'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'
const CHECKPOINT_SQL_PATH = 'ops/production-sql/20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql'
const CHECKPOINT_SIGNATURE = 'public.xrpl_create_r5_active_checkpoint_strict(text,timestamp with time zone)'
const CHECKPOINT_LEGACY_DEFINITION_SHA = 'bc135435e0d729526aff6940c96b3ef78530b4612586f82ef73a7b99e145da10'
const CHECKPOINT_FROZEN_DEFINITION_SHA = 'e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733'
const CHECKPOINT_FAIL_CLOSE_MARKER = 'r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint'
const PG_IDENTITY_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'` }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    const value = rest[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${key ?? '<end>'}`)
    options[key.slice(2)] = value
  }
  return { command, options }
}

function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  fail('Management API response contains no rows')
}

async function managementQuery(query, readOnly) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(180_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Supabase Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}

function oneState(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function validateSource(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  return sourceCommit
}

function normalizeCutoff(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(value ?? '')) fail('invalid cutoff timestamp')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) fail('invalid cutoff timestamp')
  return parsed.toISOString()
}

function normalizeIdentityTimestamp(value, fieldName) {
  const exact = String(value ?? '')
  if (!PG_IDENTITY_TIMESTAMP_PATTERN.test(exact)) fail(`invalid ${fieldName} identity timestamp`)
  return exact
}

async function resolveCutoff(options) {
  if (options.cutoff) return normalizeCutoff(options.cutoff)
  const state = oneState(await managementQuery(`select jsonb_build_object('now', clock_timestamp()) as state;`, true))
  const observed = new Date(state.now)
  if (!Number.isFinite(observed.getTime())) fail('database clock timestamp is invalid')
  return new Date(observed.getTime() - MINIMUM_AGE_HOURS * 60 * 60 * 1000).toISOString()
}

async function loadPlan(sourceCommit) {
  const checkpointSql = await readFile(CHECKPOINT_SQL_PATH, 'utf8')
  for (const required of [CHECKPOINT_LEGACY_DEFINITION_SHA, CHECKPOINT_FROZEN_DEFINITION_SHA, CHECKPOINT_FAIL_CLOSE_MARKER, 'xrpl_phase_archive_v1.terminal_messages']) {
    if (!checkpointSql.includes(required)) fail(`checkpoint freeze SQL drifted: missing ${required}`)
  }
  for (const forbidden of [/\btruncate\b/iu, /\bvacuum\b/iu, /\breindex\b/iu, /\bcron\./iu, /\bnet\./iu, /supabase_migrations/iu]) {
    if (forbidden.test(checkpointSql)) fail(`checkpoint freeze SQL contains forbidden capability: ${forbidden}`)
  }
  if (/terminalize_(?:message|completed_window)\s*\(/iu.test(checkpointSql)) fail('checkpoint freeze SQL directly invokes terminal transport mutation')
  const digestInput = {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-b-bounded-tranche-plan',
    sourceCommit,
    profileId: PROFILE_ID,
    minimumAgeHours: MINIMUM_AGE_HOURS,
    trancheLimit: TRANCHE_LIMIT,
    trancheLogicalByteLimit: TRANCHE_LOGICAL_BYTE_LIMIT,
    checkpointFreeze: {
      path: CHECKPOINT_SQL_PATH,
      sha256: sha256(checkpointSql),
      legacyDefinitionSha256: CHECKPOINT_LEGACY_DEFINITION_SHA,
      frozenDefinitionSha256: CHECKPOINT_FROZEN_DEFINITION_SHA,
    },
    physicalCompactionIncluded: false,
    vacuumIncluded: false,
    reindexIncluded: false,
    schedulerMutationIncluded: false,
    deploymentIncluded: false,
    publicReaderMutationIncluded: false,
    mainnetIncluded: false,
    r5RearmIncluded: false,
  }
  return { checkpointSql, digestInput, planDigestSha256: sha256(JSON.stringify(digestInput)) }
}

function candidateStateSql(cutoff) {
  const qCutoff = sqlLiteral(cutoff)
  return `with recursive
  eligible as materialized (
    select m.message_id, m.profile_id, m.phase, m.payload, m.result, m.successor_message_id, m.created_at, m.completed_at
    from public.xrpl_phase_messages m
    where m.profile_id = ${sqlLiteral(PROFILE_ID)}
      and m.status = 'completed'
      and m.completed_at is not null
      and m.completed_at < ${qCutoff}::timestamptz
  ),
  roots as (
    select e.message_id,
           row_number() over (order by e.created_at, e.message_id)::integer as root_rank
    from eligible e
    where not exists (
      select 1 from public.xrpl_phase_successors incoming
      where incoming.successor_message_id = e.message_id
    )
  ),
  walk(root_rank, depth, message_id) as (
    select r.root_rank, 0::integer, r.message_id from roots r
    union all
    select w.root_rank, w.depth + 1, next.message_id
    from walk w
    join public.xrpl_phase_successors edge on edge.current_message_id = w.message_id
    join eligible next on next.message_id = edge.successor_message_id
    where w.depth + 1 < ${TRANCHE_LIMIT}
  ),
  selected as (
    select w.root_rank, w.depth, e.*
    from walk w
    join eligible e on e.message_id = w.message_id
    order by w.root_rank, w.depth, e.message_id
    limit ${TRANCHE_LIMIT}
  )
select jsonb_build_object(
  'cutoff', ${qCutoff}::timestamptz,
  'eligibleCount', (select count(*) from eligible),
  'rootCount', (select count(*) from roots),
  'internalEdgeCount', (
    select count(*)
    from public.xrpl_phase_successors s
    join eligible cur on cur.message_id = s.current_message_id
    join eligible nxt on nxt.message_id = s.successor_message_id
  ),
  'missingSuccessorMappings', (
    select count(*) from eligible e
    where e.successor_message_id is null
       or not exists (
         select 1 from public.xrpl_phase_successors s
         where s.current_message_id=e.message_id and s.successor_message_id=e.successor_message_id
       )
       or not exists (
         select 1 from public.xrpl_phase_messages n where n.message_id=e.successor_message_id
       )
  ),
  'retainedToOldEdges', (
    select count(*)
    from public.xrpl_phase_successors s
    join eligible old on old.message_id=s.successor_message_id
    left join eligible cur on cur.message_id=s.current_message_id
    where cur.message_id is null
  ),
  'oldToRetainedEdges', (
    select count(*)
    from public.xrpl_phase_successors s
    join eligible old on old.message_id=s.current_message_id
    left join eligible nxt on nxt.message_id=s.successor_message_id
    where nxt.message_id is null
  ),
  'selectedLogicalBytes', coalesce((select sum(
    pg_column_size(payload) + coalesce(pg_column_size(result),0) + octet_length(message_id) + octet_length(successor_message_id) + 128
  ) from selected),0),
  'candidates', coalesce((
    select jsonb_agg(jsonb_build_object(
      'messageId', message_id,
      'profileId', profile_id,
      'phase', phase,
      'successorMessageId', successor_message_id,
      'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'completedAt', to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'payloadSha256', encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),
      'resultSha256', case when result is null then null else encode(extensions.digest(convert_to(result::text,'UTF8'),'sha256'),'hex') end
    ) order by root_rank, depth, message_id)
    from selected
  ), '[]'::jsonb)
) as state;`
}

function structuralSql() {
  return `select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'maxMigrationVersion', (select max(version::text) from supabase_migrations.schema_migrations),
    'archiveTableExists', to_regclass('xrpl_phase_archive_v1.terminal_messages') is not null,
    'terminalizeMessageExists', to_regprocedure('xrpl_phase_archive_v1.terminalize_message(text,timestamp with time zone)') is not null,
    'archiveRows', case when to_regclass('xrpl_phase_archive_v1.terminal_messages') is null then null else (select count(*) from xrpl_phase_archive_v1.terminal_messages) end,
    'archiveRlsEnabled', case when to_regclass('xrpl_phase_archive_v1.terminal_messages') is null then false else (select relrowsecurity from pg_class where oid='xrpl_phase_archive_v1.terminal_messages'::regclass) end,
    'archivePrivate', case when to_regclass('xrpl_phase_archive_v1.terminal_messages') is null then false else (
      not has_schema_privilege('anon','xrpl_phase_archive_v1','USAGE')
      and not has_schema_privilege('authenticated','xrpl_phase_archive_v1','USAGE')
      and not has_schema_privilege('service_role','xrpl_phase_archive_v1','USAGE')
      and not has_table_privilege('anon','xrpl_phase_archive_v1.terminal_messages','SELECT')
      and not has_table_privilege('authenticated','xrpl_phase_archive_v1.terminal_messages','SELECT')
      and not has_table_privilege('service_role','xrpl_phase_archive_v1.terminal_messages','SELECT')
    ) end,
    'claimGuardHelperExists', to_regprocedure('xrpl_r5_v1.database_claim_allowed(bigint)') is not null,
    'claimDefinition', pg_get_functiondef('${CLAIM_SIGNATURE}'::regprocedure),
    'checkpointDefinition', pg_get_functiondef('${CHECKPOINT_SIGNATURE}'::regprocedure),
    'canonicalCounts', jsonb_build_object(
      'messages', (select count(*) from public.xrpl_phase_messages),
      'successors', (select count(*) from public.xrpl_phase_successors),
      'work', (select count(*) from public.xrpl_phase_work),
      'referenceRows', (select count(*) from public.xrpl_phase_reference_rows)
    ),
    'run', coalesce((select jsonb_build_object(
      'runId', run_id, 'status', status, 'lastError', last_error,
      'profileRevision', profile_revision, 'profileIdentityDigest', profile_identity_digest,
      'network', network, 'epochId', epoch_id, 'completedBatches', completed_batches,
      'committedLedgers', committed_ledgers, 'watermarkLedgerIndex', current_watermark_ledger_index
    ) from xrpl_r5_v1.recovery_runs where run_id=${sqlLiteral(ACTIVE_RUN_ID)}), 'null'::jsonb),
    'batchCounts', (select jsonb_build_object(
      'total', count(*), 'pending', count(*) filter(where status='pending'),
      'leased', count(*) filter(where status='leased'), 'halted', count(*) filter(where status='halted'),
      'committed', count(*) filter(where status='committed')
    ) from xrpl_r5_v1.recovery_batches where run_id=${sqlLiteral(ACTIVE_RUN_ID)}),
    'scheduler', coalesce((select jsonb_build_object(
      'count', count(*),
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'jobId',jobid,'schedule',schedule,'active',active,
        'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')
      ) order by jobid),'[]'::jsonb)
    ) from cron.job where jobname='xrpl-lending-monitor-minute'), 'null'::jsonb)
  ) as state;`
}

function normalizeCandidate(raw) {
  return {
    messageId: String(raw.messageId),
    profileId: String(raw.profileId),
    phase: String(raw.phase),
    successorMessageId: String(raw.successorMessageId),
    createdAt: normalizeIdentityTimestamp(raw.createdAt, 'createdAt'),
    completedAt: normalizeIdentityTimestamp(raw.completedAt, 'completedAt'),
    payloadSha256: String(raw.payloadSha256),
    resultSha256: raw.resultSha256 == null ? null : String(raw.resultSha256),
  }
}

function checkpointState(definition) {
  const digest = sha256(definition ?? 'missing')
  if (digest === CHECKPOINT_LEGACY_DEFINITION_SHA) return { classification: 'legacy_exact', definitionSha256: digest }
  if (digest === CHECKPOINT_FROZEN_DEFINITION_SHA && String(definition).includes(CHECKPOINT_FAIL_CLOSE_MARKER)) {
    return { classification: 'frozen_exact', definitionSha256: digest }
  }
  return { classification: 'drift', definitionSha256: digest }
}

function validateHaltedRun(state) {
  if (!state.run || state.run.runId !== ACTIVE_RUN_ID) fail('active revision-4 successor run missing')
  if (Number(state.run.profileRevision) !== 4 || state.run.network !== 'devnet') fail('active revision-4 run identity drifted')
  if (state.run.status !== 'halted' || state.run.lastError !== 'r5_recovery_database_halt') fail('R5 successor is not database-guard halted')
}

async function inspect(sourceCommit, plan, cutoff) {
  const [graphRaw, structure] = await Promise.all([
    managementQuery(candidateStateSql(cutoff), true).then(oneState),
    managementQuery(structuralSql(), true).then(oneState),
  ])
  if (structure.archiveTableExists !== true || structure.terminalizeMessageExists !== true) fail('terminal archive Phase A contract is not installed')
  if (structure.archiveRlsEnabled !== true || structure.archivePrivate !== true) fail('terminal archive private/RLS contract drifted')
  if (structure.claimGuardHelperExists !== true || !String(structure.claimDefinition ?? '').includes('database_claim_allowed') || !String(structure.claimDefinition ?? '').includes('r5_recovery_database_halt')) fail('R5 database guard is not installed')
  validateHaltedRun(structure)
  const checkpoint = checkpointState(structure.checkpointDefinition)
  if (checkpoint.classification === 'drift') fail(`checkpoint definition drifted: ${checkpoint.definitionSha256}`)
  const archiveRows = Number(structure.archiveRows)
  if (archiveRows > 0 && checkpoint.classification !== 'frozen_exact') fail('archive rows exist while legacy full-history checkpoint remains executable')

  const eligibleCount = Number(graphRaw.eligibleCount)
  const rootCount = Number(graphRaw.rootCount)
  const internalEdgeCount = Number(graphRaw.internalEdgeCount)
  const missingSuccessorMappings = Number(graphRaw.missingSuccessorMappings)
  const retainedToOldEdges = Number(graphRaw.retainedToOldEdges)
  const oldToRetainedEdges = Number(graphRaw.oldToRetainedEdges)
  const selectedLogicalBytes = Number(graphRaw.selectedLogicalBytes)
  if (missingSuccessorMappings !== 0) fail('Phase B candidates have missing/mismatched successor mappings')
  if (retainedToOldEdges !== 0) fail('retained-to-old edge blocks root-first Phase B drain')
  if (eligibleCount > 0 && rootCount < 1) fail('Phase B candidates have no drain root')
  if (eligibleCount > 0 && internalEdgeCount !== eligibleCount - rootCount) fail('Phase B eligible graph is not a root-drainable chain forest')

  const candidates = (graphRaw.candidates ?? []).map(normalizeCandidate)
  if (candidates.length > TRANCHE_LIMIT) fail('candidate tranche exceeds fixed bound')
  if (!Number.isFinite(selectedLogicalBytes) || selectedLogicalBytes < 0 || selectedLogicalBytes > TRANCHE_LOGICAL_BYTE_LIMIT) fail(`candidate tranche logical bytes exceed fixed bound: ${selectedLogicalBytes}`)
  if (eligibleCount > 0 && candidates.length < 1) fail('eligible Phase B rows exist but bounded candidate tranche is empty')
  for (const candidate of candidates) {
    if (candidate.profileId !== PROFILE_ID) fail('candidate profile drifted')
    if (!['scan','commit','finalize'].includes(candidate.phase)) fail('candidate phase drifted')
    if (!PG_IDENTITY_TIMESTAMP_PATTERN.test(candidate.createdAt) || !PG_IDENTITY_TIMESTAMP_PATTERN.test(candidate.completedAt)) fail('candidate identity timestamp invalid')
    if (!/^[a-f0-9]{64}$/u.test(candidate.payloadSha256) || (candidate.resultSha256 != null && !/^[a-f0-9]{64}$/u.test(candidate.resultSha256))) fail('candidate digest invalid')
  }
  const candidateDigestSha256 = sha256(JSON.stringify(candidates))
  const projectIdentityDigest = sha256(requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u))
  const schedulerSha256 = sha256(JSON.stringify(structure.scheduler ?? null))
  const structural = {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-b-bounded-tranche-authorization-state',
    sourceCommit,
    projectIdentityDigest,
    planDigestSha256: plan.planDigestSha256,
    cutoff,
    profileId: PROFILE_ID,
    minimumAgeHours: MINIMUM_AGE_HOURS,
    trancheLimit: TRANCHE_LIMIT,
    trancheLogicalByteLimit: TRANCHE_LOGICAL_BYTE_LIMIT,
    selectedLogicalBytes,
    candidateDigestSha256,
    candidateCount: candidates.length,
    eligibleCount,
    rootCount,
    internalEdgeCount,
    missingSuccessorMappings,
    retainedToOldEdges,
    oldToRetainedEdges,
    archiveRows,
    checkpoint,
    canonicalCounts: structure.canonicalCounts,
    activeRun: structure.run,
    batchCounts: structure.batchCounts,
    schedulerSha256,
    maxMigrationVersion: String(structure.maxMigrationVersion ?? ''),
  }
  return {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-b-bounded-tranche-state',
    sourceCommit,
    projectIdentityDigest,
    plan: plan.digestInput,
    planDigestSha256: plan.planDigestSha256,
    cutoff,
    candidates,
    candidateDigestSha256,
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    databaseBytes: Number(structure.databaseBytes),
    databaseHaltBytes: INTERNAL_DB_HALT,
    databaseHeadroomBytes: INTERNAL_DB_HALT - Number(structure.databaseBytes),
    eligibleCount,
    rootCount,
    internalEdgeCount,
    oldToRetainedEdges,
    selectedLogicalBytes,
    archiveRows,
    checkpoint,
    canonicalCounts: structure.canonicalCounts,
    activeRun: structure.run,
    batchCounts: structure.batchCounts,
    scheduler: structure.scheduler,
    schedulerSha256,
    maxMigrationVersion: String(structure.maxMigrationVersion ?? ''),
    productionDatabaseReadOnly: true,
    checkpointFreezeAuthorized: false,
    terminalTransportArchiveDeleteAuthorized: false,
    physicalCompactionAuthorized: false,
    vacuumAuthorized: false,
    reindexAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RearmAuthorized: false,
  }
}

function candidateGuardSql(candidates) {
  const expectedJson = JSON.stringify(candidates)
  return `do $candidate_guard$
declare
  v_candidate jsonb;
  v_result_sha text;
begin
  for v_candidate in select value from jsonb_array_elements(${sqlLiteral(expectedJson)}::jsonb)
  loop
    select case when m.result is null then null else encode(extensions.digest(convert_to(m.result::text,'UTF8'),'sha256'),'hex') end
    into v_result_sha
    from public.xrpl_phase_messages m
    join public.xrpl_phase_successors s on s.current_message_id=m.message_id
    where m.message_id=v_candidate->>'messageId'
      and m.profile_id=v_candidate->>'profileId'
      and m.phase=v_candidate->>'phase'
      and m.status='completed'
      and m.successor_message_id=v_candidate->>'successorMessageId'
      and s.successor_message_id=v_candidate->>'successorMessageId'
      and m.completed_at=(v_candidate->>'completedAt')::timestamptz
      and m.created_at=(v_candidate->>'createdAt')::timestamptz
      and encode(extensions.digest(convert_to(m.payload::text,'UTF8'),'sha256'),'hex')=v_candidate->>'payloadSha256';
    if not found or v_result_sha is distinct from nullif(v_candidate->>'resultSha256','') then
      raise exception 'authorized Phase B candidate identity drifted: %', v_candidate->>'messageId';
    end if;
  end loop;
end;
$candidate_guard$;`
}

function terminalizeSql(candidates) {
  const ids = candidates.map((candidate) => sqlLiteral(candidate.messageId)).join(',')
  return `do $terminalize$
declare
  v_message_id text;
  v_archived_at timestamptz := clock_timestamp();
begin
  foreach v_message_id in array array[${ids}]::text[]
  loop
    perform xrpl_phase_archive_v1.terminalize_message(v_message_id, v_archived_at);
  end loop;
end;
$terminalize$;`
}

async function verifyArchived(candidates) {
  if (candidates.length < 1) fail('cannot verify empty candidate tranche')
  const ids = candidates.map((candidate) => sqlLiteral(candidate.messageId)).join(',')
  const state = oneState(await managementQuery(`select jsonb_build_object(
    'liveMessages', (select count(*) from public.xrpl_phase_messages where message_id in (${ids})),
    'liveMappings', (select count(*) from public.xrpl_phase_successors where current_message_id in (${ids})),
    'archive', coalesce((select jsonb_agg(jsonb_build_object(
      'messageId', message_id,
      'profileId', profile_id,
      'phase', phase,
      'successorMessageId', successor_message_id,
      'completedAt', to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'payloadSha256', encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),
      'resultSha256', result_digest
    ) order by message_id) from xrpl_phase_archive_v1.terminal_messages where message_id in (${ids})), '[]'::jsonb)
  ) as state;`, true))
  if (Number(state.liveMessages) !== 0 || Number(state.liveMappings) !== 0) fail('authorized Phase B candidate remains in live transport')
  const expected = candidates.map(({ createdAt, ...candidate }) => candidate).sort((a,b)=>a.messageId.localeCompare(b.messageId))
  const actual = (state.archive ?? []).map((raw)=>({
    messageId:String(raw.messageId), profileId:String(raw.profileId), phase:String(raw.phase),
    successorMessageId:String(raw.successorMessageId), completedAt:normalizeIdentityTimestamp(raw.completedAt, 'archived completedAt'),
    payloadSha256:String(raw.payloadSha256), resultSha256:raw.resultSha256==null?null:String(raw.resultSha256),
  })).sort((a,b)=>a.messageId.localeCompare(b.messageId))
  if (!same(actual, expected)) fail('archived candidate identities do not match exact authorized tranche')
  return { liveMessages: 0, liveMappings: 0, archive: actual }
}

async function prepare(options) {
  const sourceCommit = validateSource(options)
  const cutoff = await resolveCutoff(options)
  const plan = await loadPlan(sourceCommit)
  const state = await inspect(sourceCommit, plan, cutoff)
  if (state.candidates.length < 1) fail('no eligible terminal transport rows for Phase B tranche')
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}

async function apply(options) {
  const sourceCommit = validateSource(options)
  const cutoff = normalizeCutoff(options.cutoff)
  const authorizedState = options['authorized-state']
  const authorizedPlan = options['authorized-plan']
  const authorizedCandidates = options['authorized-candidates']
  for (const [name, value] of [['authorized-state',authorizedState],['authorized-plan',authorizedPlan],['authorized-candidates',authorizedCandidates]]) {
    if (!/^[a-f0-9]{64}$/u.test(value ?? '')) fail(`invalid --${name}`)
  }
  const plan = await loadPlan(sourceCommit)
  if (plan.planDigestSha256 !== authorizedPlan) fail('authorized Phase B plan digest does not match staged plan')
  const before = await inspect(sourceCommit, plan, cutoff)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized Phase B structural state drifted before mutation')
  if (before.candidateDigestSha256 !== authorizedCandidates) fail('authorized Phase B candidate digest drifted before mutation')
  const candidates = before.candidates
  if (candidates.length < 1 || candidates.length > TRANCHE_LIMIT) fail('authorized Phase B tranche size is invalid')

  const guard = before.structuralState
  const transaction = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '180s';",
    "select pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b', 0));",
    "select pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0));",
    `do $state_guard$ begin
      if (select count(*) from xrpl_phase_archive_v1.terminal_messages) <> ${guard.archiveRows} then raise exception 'Phase B archive row count drifted inside mutation transaction'; end if;
      if (select count(*) from public.xrpl_phase_messages) <> ${Number(guard.canonicalCounts.messages)} then raise exception 'Phase B live message count drifted inside mutation transaction'; end if;
      if (select count(*) from public.xrpl_phase_successors) <> ${Number(guard.canonicalCounts.successors)} then raise exception 'Phase B live successor count drifted inside mutation transaction'; end if;
      if not exists (select 1 from xrpl_r5_v1.recovery_runs where run_id=${sqlLiteral(ACTIVE_RUN_ID)} and status='halted' and last_error='r5_recovery_database_halt' and profile_revision=4 and network='devnet') then raise exception 'Phase B R5 database halt drifted inside mutation transaction'; end if;
    end; $state_guard$;`,
    `-- BEGIN EXACT CHECKPOINT FREEZE FILE ${CHECKPOINT_SQL_PATH}\n${plan.checkpointSql}\n-- END EXACT CHECKPOINT FREEZE FILE ${CHECKPOINT_SQL_PATH}`,
    candidateGuardSql(candidates),
    terminalizeSql(candidates),
    'commit;',
  ].join('\n')
  for (const forbidden of [/\btruncate\b/iu, /\bvacuum\b/iu, /\breindex\b/iu, /\bcron\./iu, /\bnet\./iu]) {
    if (forbidden.test(transaction)) fail(`assembled Phase B transaction contains forbidden capability: ${forbidden}`)
  }
  await managementQuery(transaction, false)

  const archivedVerification = await verifyArchived(candidates)
  const after = await inspect(sourceCommit, plan, cutoff)
  const n = candidates.length
  if (after.archiveRows !== before.archiveRows + n) fail('Phase B archive row count delta mismatch')
  if (Number(after.canonicalCounts.messages) !== Number(before.canonicalCounts.messages) - n) fail('Phase B live message count delta mismatch')
  if (Number(after.canonicalCounts.successors) !== Number(before.canonicalCounts.successors) - n) fail('Phase B live successor count delta mismatch')
  if (Number(after.canonicalCounts.work) !== Number(before.canonicalCounts.work) || Number(after.canonicalCounts.referenceRows) !== Number(before.canonicalCounts.referenceRows)) fail('canonical work/reference history changed during Phase B')
  if (!same(after.activeRun, before.activeRun) || !same(after.batchCounts, before.batchCounts)) fail('R5 halted run/batch state changed during Phase B')
  if (after.schedulerSha256 !== before.schedulerSha256) fail('scheduler state changed during Phase B')
  if (after.maxMigrationVersion !== before.maxMigrationVersion) fail('production migration head changed during Phase B')
  if (after.checkpoint.classification !== 'frozen_exact' || after.checkpoint.definitionSha256 !== CHECKPOINT_FROZEN_DEFINITION_SHA) fail('legacy full-history checkpoint was not frozen before Phase B rows moved')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-terminal-archive-phase-b-bounded-tranche-apply',
    sourceCommit,
    cutoff,
    authorizedStateSha256: authorizedState,
    authorizedPlanDigestSha256: authorizedPlan,
    authorizedCandidateDigestSha256: authorizedCandidates,
    trancheLimit: TRANCHE_LIMIT,
    archivedCount: n,
    authorizedCandidateLogicalBytes: before.structuralState.selectedLogicalBytes,
    archivedMessageIdsSha256: sha256(JSON.stringify(candidates.map((c)=>c.messageId))),
    archiveRowsBefore: before.archiveRows,
    archiveRowsAfter: after.archiveRows,
    canonicalCountsBefore: before.canonicalCounts,
    canonicalCountsAfter: after.canonicalCounts,
    checkpointBefore: before.checkpoint,
    checkpointAfter: after.checkpoint,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    databaseHaltBytes: INTERNAL_DB_HALT,
    remainingEligibleAtAuthorizedCutoff: after.eligibleCount,
    nextCandidateDigestSha256: after.candidateDigestSha256,
    archivedVerification: { liveMessages: archivedVerification.liveMessages, liveMappings: archivedVerification.liveMappings, archiveIdentityVerified: true },
    activeRunBefore: before.activeRun,
    activeRunAfter: after.activeRun,
    schedulerSha256Before: before.schedulerSha256,
    schedulerSha256After: after.schedulerSha256,
    maxMigrationVersionBefore: before.maxMigrationVersion,
    maxMigrationVersionAfter: after.maxMigrationVersion,
    checkpointFreezePerformed: before.checkpoint.classification === 'legacy_exact',
    terminalTransportArchiveDeletePerformed: true,
    canonicalWorkReferenceHistoryMutationPerformed: false,
    physicalCompactionPerformed: false,
    vacuumPerformed: false,
    reindexPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
    stabilizationPerformed: false,
    soakPerformed: false,
    r5Rearmed: false,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else fail('command must be prepare or apply')
