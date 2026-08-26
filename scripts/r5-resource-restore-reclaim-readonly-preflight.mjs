import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

function fail(message) {
  throw new Error(message)
}

function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) fail(`invalid argument: ${arg}`)
    const key = arg.slice(2)
    const value = args[i + 1]
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`)
    out[key] = value
    i += 1
  }
  return out
}

const MUTATION_CAPABILITY = /\b(delete|update|insert|alter|drop|truncate|vacuum|create|grant|revoke|refresh|cluster|reindex)\b/iu

const SQL = String.raw`
with restore_tables as (
  select
    c.relname as table_name,
    pg_total_relation_size(c.oid)::bigint as total_bytes,
    coalesce(s.n_live_tup, 0)::bigint as estimated_live_rows,
    coalesce(s.n_dead_tup, 0)::bigint as estimated_dead_rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_all_tables s on s.relid = c.oid
  where n.nspname = 'xrpl_resource_restore_v1'
    and c.relkind = 'r'
), target_state as (
  select
    t.target_id,
    t.source_session_id,
    t.state_digest,
    q.result,
    (
      q.session_id is not null
      and coalesce(q.result->>'targetId', '') = t.target_id
      and coalesce(q.result->>'stateDigest', '') = t.state_digest
      and coalesce((q.result #>> '{checks,rolling31dStateExported}')::boolean, false)
      and coalesce((q.result #>> '{checks,typedRestoreCompleted}')::boolean, false)
      and coalesce((q.result #>> '{checks,canonicalDigestParity}')::boolean, false)
      and coalesce((q.result #>> '{checks,duplicateRestoreConverged}')::boolean, false)
      and coalesce((q.result #>> '{checks,digestTamperRejected}')::boolean, false)
      and coalesce((q.result #>> '{checks,effectiveEgressPreserved}')::boolean, false)
      and coalesce((q.result #>> '{checks,reservedInvocationsPreserved}')::boolean, false)
      and coalesce((q.result #>> '{checks,activeProfileReadOnly}')::boolean, false)
    ) as durable_match
  from xrpl_resource_restore_v1.targets t
  left join xrpl_resource_guard_v2.transfer_qualifications q
    on q.session_id = t.source_session_id
), direct_consumers as (
  select
    p.oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    n.nspname = 'xrpl_r5_v1' as revision4_runtime_schema,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    p.prosrc ilike '%xrpl_resource_restore_v1%' as names_restore_schema,
    p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' as names_restore_rpc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and (
      p.prosrc ilike '%xrpl_resource_restore_v1%'
      or p.prosrc ilike '%xrpl_restore_revision3_accounting_state%'
    )
), direct_callers as (
  select
    p.oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%' as calls_qualify,
    p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' as calls_restore,
    p.prosrc ilike '%build_restored_accounting_state%' as calls_restore_builder
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and (
      p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%'
      or p.prosrc ilike '%xrpl_restore_revision3_accounting_state%'
      or p.prosrc ilike '%build_restored_accounting_state%'
    )
), trigger_bindings as (
  select
    tn.nspname as table_schema,
    tc.relname as table_name,
    tg.tgname as trigger_name,
    pn.nspname as function_schema,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    not tg.tgisinternal as user_trigger
  from pg_trigger tg
  join pg_class tc on tc.oid = tg.tgrelid
  join pg_namespace tn on tn.oid = tc.relnamespace
  join pg_proc p on p.oid = tg.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where p.oid in (select oid from direct_callers)
     or p.oid in (select oid from direct_consumers)
), rev3_sessions as (
  select
    count(*)::bigint as total,
    count(*) filter (where status = 'completed')::bigint as completed,
    count(*) filter (where status <> 'completed')::bigint as not_completed,
    count(*) filter (where status = 'completed' and resource_guard_enabled)::bigint
      as completed_guarded,
    count(*) filter (where status = 'completed' and not resource_guard_enabled)::bigint
      as completed_unguarded,
    count(*) filter (where status <> 'completed' and resource_guard_enabled)::bigint
      as not_completed_guarded,
    count(*) filter (where status <> 'completed' and not resource_guard_enabled)::bigint
      as not_completed_unguarded,
    count(*) filter (
      where status = 'completed'
        and resource_guard_enabled
        and exists (
          select 1
          from xrpl_resource_guard_v2.transfer_qualifications q
          where q.session_id = s.session_id
        )
    )::bigint as completed_guarded_with_transfer_qualification,
    count(*) filter (
      where status = 'completed'
        and resource_guard_enabled
        and not exists (
          select 1
          from xrpl_resource_guard_v2.transfer_qualifications q
          where q.session_id = s.session_id
        )
    )::bigint as completed_guarded_without_transfer_qualification,
    count(*) filter (
      where status = 'completed'
        and not resource_guard_enabled
        and not exists (
          select 1
          from xrpl_resource_guard_v2.transfer_qualifications q
          where q.session_id = s.session_id
        )
    )::bigint as completed_unguarded_without_transfer_qualification,
    count(*) filter (
      where status = 'completed'
        and not exists (
          select 1
          from xrpl_resource_guard_v2.transfer_qualifications q
          where q.session_id = s.session_id
        )
    )::bigint as completed_without_transfer_qualification
  from xrpl_steady_v1.sessions s
), transfer_qualification_coverage as (
  select
    count(*)::bigint as total,
    count(*) filter (where s.session_id is null)::bigint as without_session,
    count(*) filter (where s.session_id is not null and s.status = 'completed')::bigint
      as completed_session,
    count(*) filter (
      where s.session_id is not null
        and s.status = 'completed'
        and s.resource_guard_enabled
    )::bigint as completed_guarded_session,
    count(*) filter (
      where s.session_id is not null
        and (s.status <> 'completed' or not s.resource_guard_enabled)
    )::bigint as outside_completed_guarded_session
  from xrpl_resource_guard_v2.transfer_qualifications q
  left join xrpl_steady_v1.sessions s on s.session_id = q.session_id
), guard_attempts as (
  select
    count(*)::bigint as total,
    count(*) filter (where status = 'open')::bigint as open,
    count(*) filter (where status = 'succeeded')::bigint as succeeded,
    count(*) filter (where status = 'failed')::bigint as failed,
    count(*) filter (where status = 'deferred')::bigint as deferred
  from xrpl_resource_guard_v2.attempts
), views as (
  select schemaname as schema_name, viewname as view_name
  from pg_views
  where definition ilike '%xrpl_resource_restore_v1%'
     or definition ilike '%xrpl_restore_revision3_accounting_state%'
)
select jsonb_build_object(
  'schemaVersion', 3,
  'observedAt', clock_timestamp(),
  'databaseBytes', pg_database_size(current_database())::bigint,
  'databaseHeadroomBytes', 400000000::bigint - pg_database_size(current_database())::bigint,
  'restoreSchemaBytes', coalesce((select sum(total_bytes)::bigint from restore_tables), 0),
  'restoreTables', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_bytes desc, x.table_name) from restore_tables x), '[]'::jsonb),
  'targets', jsonb_build_object(
    'total', (select count(*)::bigint from target_state),
    'durablyQualifiedMatching', (select count(*)::bigint from target_state where durable_match),
    'notDurablyQualifiedMatching', (select count(*)::bigint from target_state where not durable_match)
  ),
  'directConsumers', coalesce((select jsonb_agg(to_jsonb(x) - 'oid' order by x.schema_name, x.function_name, x.identity_arguments) from direct_consumers x), '[]'::jsonb),
  'directCallers', coalesce((select jsonb_agg(to_jsonb(x) - 'oid' order by x.schema_name, x.function_name, x.identity_arguments) from direct_callers x), '[]'::jsonb),
  'triggerBindings', coalesce((select jsonb_agg(to_jsonb(x) order by x.table_schema, x.table_name, x.trigger_name) from trigger_bindings x), '[]'::jsonb),
  'views', coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name, x.view_name) from views x), '[]'::jsonb),
  'revision4RuntimeConsumerCount', (select count(*)::bigint from direct_consumers where revision4_runtime_schema),
  'revision3Sessions', (select to_jsonb(x) from rev3_sessions x),
  'transferQualificationCoverage', (select to_jsonb(x) from transfer_qualification_coverage x),
  'guardAttempts', (select to_jsonb(x) from guard_attempts x),
  'reclaimEvidence', jsonb_build_object(
    'allRestoreTargetsDurablyQualified',
      (select count(*) from target_state where not durable_match) = 0,
    'allCompletedGuardedSessionsQualified',
      (select completed_guarded_without_transfer_qualification from rev3_sessions) = 0,
    'allTransferQualificationsBelongToCompletedGuardedSessions',
      (select outside_completed_guarded_session from transfer_qualification_coverage) = 0
      and (select without_session from transfer_qualification_coverage) = 0,
    'noRevision4RuntimeConsumers', (select count(*) from direct_consumers where revision4_runtime_schema) = 0,
    'noOpenGuardAttempts', (select open from guard_attempts) = 0
  ),
  'safetyBoundary', jsonb_build_object(
    'probeReadOnly', true,
    'measurementOnly', true,
    'restoreReclaimAuthorized', false,
    'functionRetirementAuthorized', false,
    'rowMutationAuthorized', false,
    'schemaMutationAuthorized', false,
    'vacuumAuthorized', false,
    'schedulerMutationAuthorized', false,
    'deploymentAuthorized', false,
    'r5RestartAuthorized', false,
    'mainnetDisabled', true
  )
)::text as state;
`

if (MUTATION_CAPABILITY.test(SQL)) fail('restore reclaim preflight SQL contains forbidden mutation capability')

async function managementQuery(query) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, read_only: true }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  if (!response.ok) fail(`management query failed: ${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

function findState(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail('unexpected management query result')
  const raw = rows[0]?.state
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  fail('restore reclaim preflight state missing')
}

function requireFutureDemandEvidence(evidence, sourceCommit) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('future-demand evidence missing')
  }
  if (evidence.sourceCommit !== sourceCommit) fail('future-demand evidence source commit mismatch')
  const safety = evidence.safety ?? {}
  for (const key of ['productionDatabaseReadOnly', 'measurementOnly', 'mainnetDisabled']) {
    if (safety[key] !== true) fail(`future-demand safety boundary missing: ${key}`)
  }
  for (const key of [
    'permissionMutationAuthorized',
    'schedulerMutationAuthorized',
    'functionRetirementAuthorized',
    'restoreReclaimAuthorized',
    'schemaMutationAuthorized',
    'physicalCompactionAuthorized',
    'deploymentAuthorized',
    'r5RearmAuthorized',
  ]) {
    if (safety[key] !== false) fail(`future-demand evidence unexpectedly authorizes: ${key}`)
  }
  return evidence
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
const outputDir = options['output-dir'] ?? 'r5-index-footprint-readonly-probe'
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const state = findState(await managementQuery(SQL))
const safety = state.safetyBoundary ?? {}
for (const key of ['probeReadOnly', 'measurementOnly', 'mainnetDisabled']) {
  if (safety[key] !== true) fail(`restore reclaim preflight safety boundary missing: ${key}`)
}
for (const key of [
  'restoreReclaimAuthorized',
  'functionRetirementAuthorized',
  'rowMutationAuthorized',
  'schemaMutationAuthorized',
  'vacuumAuthorized',
  'schedulerMutationAuthorized',
  'deploymentAuthorized',
  'r5RestartAuthorized',
]) {
  if (safety[key] !== false) fail(`restore reclaim preflight unexpectedly authorizes: ${key}`)
}

await mkdir(outputDir, { recursive: true })
await import('./r5-revision3-future-demand-readonly-audit.mjs')
const futureDemandEnvelope = JSON.parse(
  await readFile(`${outputDir}/revision3-future-demand-evidence.json`, 'utf8'),
)
const futureDemand = requireFutureDemandEvidence(futureDemandEnvelope, sourceCommit)

const directConsumers = Array.isArray(state.directConsumers) ? state.directConsumers : []
const directCallers = Array.isArray(state.directCallers) ? state.directCallers : []
const triggerBindings = Array.isArray(state.triggerBindings) ? state.triggerBindings : []
const views = Array.isArray(state.views) ? state.views : []
const noServiceRoleExecutableRestoreConsumers = directConsumers.every(
  (row) => row.service_role_execute === false,
)
const noServiceRoleExecutableRestoreCallers = directCallers.every(
  (row) => row.service_role_execute === false,
)
const noRestoreTriggerBindings = triggerBindings.length === 0
const noRestoreViews = views.length === 0
const futureRevision3QualificationDemandProvenClosed =
  futureDemand.runtimeFutureRevision3DemandProvenClosed === true

const restoreSchemaRemovalProvenSafe =
  state.reclaimEvidence?.allRestoreTargetsDurablyQualified === true
  && state.reclaimEvidence?.allTransferQualificationsBelongToCompletedGuardedSessions === true
  && state.reclaimEvidence?.noRevision4RuntimeConsumers === true
  && state.reclaimEvidence?.noOpenGuardAttempts === true
  && futureRevision3QualificationDemandProvenClosed
  && noServiceRoleExecutableRestoreConsumers
  && noServiceRoleExecutableRestoreCallers
  && noRestoreTriggerBindings
  && noRestoreViews

state.reclaimEvidence = {
  ...(state.reclaimEvidence ?? {}),
  futureRevision3QualificationDemandProvenClosed,
  noServiceRoleExecutableRestoreConsumers,
  noServiceRoleExecutableRestoreCallers,
  noRestoreTriggerBindings,
  noRestoreViews,
  restoreSchemaRemovalProvenSafe,
}
state.futureDemandEvidence = {
  schemaVersion: futureDemand.schemaVersion,
  querySha256: futureDemand.querySha256,
  runtimeFutureRevision3DemandProvenClosed:
    futureDemand.runtimeFutureRevision3DemandProvenClosed === true,
  serviceRoleExecutableTargetCount: futureDemand.serviceRoleExecutableTargetCount,
  serviceRoleExecutableCallerCount: futureDemand.serviceRoleExecutableCallerCount,
  activeLegacyCronJobCount: futureDemand.activeLegacyCronJobCount,
  transferTriggerBindingCount: Array.isArray(futureDemand.transferTriggerBindings)
    ? futureDemand.transferTriggerBindings.length
    : null,
  liveLeasedTicks: Number(futureDemand.tickState?.live_leased ?? 0),
  openAttempts: Number(futureDemand.attemptState?.open ?? 0),
}

const evidence = {
  sourceCommit,
  querySha256: createHash('sha256').update(SQL).digest('hex'),
  state,
}
const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const evidenceSha256 = createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/resource-restore-reclaim-preflight.json`, serialized)
await writeFile(`${outputDir}/resource-restore-reclaim-preflight.sha256`, `${evidenceSha256}\n`)

const consumerLines = directConsumers.map(
  (x) => `- consumer: \`${x.schema_name}.${x.function_name}(${x.identity_arguments})\`, service_role_execute=${x.service_role_execute}, revision4_runtime=${x.revision4_runtime_schema}`,
)
const callerLines = directCallers.map(
  (x) => `- caller: \`${x.schema_name}.${x.function_name}(${x.identity_arguments})\`, service_role_execute=${x.service_role_execute}, calls_qualify=${x.calls_qualify}, calls_restore=${x.calls_restore}, calls_builder=${x.calls_restore_builder}`,
)
const triggerLines = triggerBindings.map(
  (x) => `- trigger: \`${x.table_schema}.${x.table_name}.${x.trigger_name}\` -> \`${x.function_schema}.${x.function_name}(${x.identity_arguments})\`` ,
)
const summary = [
  '## R5 revision-3 restore reclaim read-only preflight',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes / 400MB headroom: \`${state.databaseBytes} / ${state.databaseHeadroomBytes}\``,
  `- restore schema bytes: \`${state.restoreSchemaBytes}\``,
  `- targets durable matching / total: \`${state.targets?.durablyQualifiedMatching ?? 0} / ${state.targets?.total ?? 0}\``,
  `- targets not durably matching: \`${state.targets?.notDurablyQualifiedMatching ?? 0}\``,
  `- revision-4 runtime consumers: \`${state.revision4RuntimeConsumerCount ?? 0}\``,
  `- restore direct consumers / direct callers / trigger bindings / views: \`${directConsumers.length} / ${directCallers.length} / ${triggerBindings.length} / ${views.length}\``,
  `- revision-3 sessions total / completed / not completed: \`${state.revision3Sessions?.total ?? 0} / ${state.revision3Sessions?.completed ?? 0} / ${state.revision3Sessions?.not_completed ?? 0}\``,
  `- completed guarded / unguarded: \`${state.revision3Sessions?.completed_guarded ?? 0} / ${state.revision3Sessions?.completed_unguarded ?? 0}\``,
  `- completed guarded with / without transfer qualification: \`${state.revision3Sessions?.completed_guarded_with_transfer_qualification ?? 0} / ${state.revision3Sessions?.completed_guarded_without_transfer_qualification ?? 0}\``,
  `- completed unguarded without transfer qualification: \`${state.revision3Sessions?.completed_unguarded_without_transfer_qualification ?? 0}\``,
  `- not-completed guarded / unguarded: \`${state.revision3Sessions?.not_completed_guarded ?? 0} / ${state.revision3Sessions?.not_completed_unguarded ?? 0}\``,
  `- transfer qualifications total / completed guarded / outside completed guarded / without session: \`${state.transferQualificationCoverage?.total ?? 0} / ${state.transferQualificationCoverage?.completed_guarded_session ?? 0} / ${state.transferQualificationCoverage?.outside_completed_guarded_session ?? 0} / ${state.transferQualificationCoverage?.without_session ?? 0}\``,
  `- resource-guard attempts total / open / succeeded / failed / deferred: \`${state.guardAttempts?.total ?? 0} / ${state.guardAttempts?.open ?? 0} / ${state.guardAttempts?.succeeded ?? 0} / ${state.guardAttempts?.failed ?? 0} / ${state.guardAttempts?.deferred ?? 0}\``,
  `- all restore targets durably qualified: \`${state.reclaimEvidence?.allRestoreTargetsDurablyQualified ?? false}\``,
  `- all completed guarded sessions qualified (historical diagnostic): \`${state.reclaimEvidence?.allCompletedGuardedSessionsQualified ?? false}\``,
  `- all transfer qualifications belong to completed guarded sessions: \`${state.reclaimEvidence?.allTransferQualificationsBelongToCompletedGuardedSessions ?? false}\``,
  `- no service-role executable restore consumers / callers: \`${noServiceRoleExecutableRestoreConsumers} / ${noServiceRoleExecutableRestoreCallers}\``,
  `- no restore trigger bindings / views: \`${noRestoreTriggerBindings} / ${noRestoreViews}\``,
  `- future revision-3 qualification demand proven closed: \`${futureRevision3QualificationDemandProvenClosed}\``,
  `- restore schema removal proven safe: \`${restoreSchemaRemovalProvenSafe}\``,
  '',
  ...consumerLines,
  ...callerLines,
  ...triggerLines,
  '',
  'Measurement only. The removal verdict is derived fail-closed from durable target parity, transfer-qualification ownership, revision-4 isolation, open-attempt absence, independent revision-3 future-demand closure, executable restore-consumer/caller absence, and zero restore trigger/view bindings. Historical completed guarded sessions without a transfer qualification remain visible as a diagnostic; they are not a removal blocker once every retained restore target is durably matched and future revision-3 qualification demand is independently proven closed. This verdict authorizes no function retirement, restore-table/schema removal, physical compaction, R5 rearm, scheduler change, deployment, or Mainnet action.',
  '',
  `Evidence SHA-256: \`${evidenceSha256}\``,
].join('\n')
await writeFile(`${outputDir}/resource-restore-reclaim-preflight-summary.md`, `${summary}\n`)
console.log(summary)
