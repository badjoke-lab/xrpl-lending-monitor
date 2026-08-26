import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const TARGETS = [
  'xrpl_prepare_network_steady_session',
  'xrpl_claim_network_steady_tick',
  'xrpl_record_revision3_tick_accounting',
  'xrpl_complete_network_steady_tick',
  'xrpl_begin_revision3_attempt',
  'xrpl_finalize_revision3_attempt',
  'xrpl_qualify_revision3_accounting_transfer',
  'xrpl_restore_revision3_accounting_state',
]

const MUTATION_CAPABILITY = /\b(delete|update|insert|alter|drop|truncate|vacuum|create|grant|revoke|refresh|cluster|reindex)\b/iu

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
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) {
      fail(`invalid argument near ${key ?? '<end>'}`)
    }
    out[key.slice(2)] = value
  }
  return out
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

const targetSql = TARGETS.map((name) => `('${name}')`).join(',\n    ')
const SQL = `with recursive target_names(function_name) as (
  values
    ${targetSql}
), seed as (
  select
    p.oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosrc,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join target_names t on t.function_name = p.proname
  where n.nspname in ('public', 'xrpl_resource_guard_v2')
    and p.prokind = 'f'
), closure as (
  select
    s.oid,
    s.schema_name,
    s.function_name,
    s.identity_arguments,
    s.prosrc,
    0 as depth,
    null::text collate "C" as depends_on,
    array[s.oid]::oid[] as path,
    s.service_role_execute,
    s.authenticated_execute,
    s.anon_execute
  from seed s
  union all
  select
    caller.oid,
    cn.nspname,
    caller.proname,
    pg_get_function_identity_arguments(caller.oid),
    caller.prosrc,
    parent.depth + 1,
    parent.function_name,
    parent.path || caller.oid,
    has_function_privilege('service_role', caller.oid, 'EXECUTE'),
    has_function_privilege('authenticated', caller.oid, 'EXECUTE'),
    has_function_privilege('anon', caller.oid, 'EXECUTE')
  from closure parent
  join pg_proc caller on caller.prosrc ilike ('%' || parent.function_name || '(%')
  join pg_namespace cn on cn.oid = caller.pronamespace
  where cn.nspname in ('public', 'xrpl_steady_v1', 'xrpl_resource_guard_v2')
    and caller.prokind = 'f'
    and not caller.oid = any(parent.path)
    and parent.depth < 12
), closure_rows as (
  select
    c.*,
    encode(extensions.digest(convert_to(c.prosrc, 'UTF8'), 'sha256'), 'hex') as source_sha256
  from closure c
), legacy_cron as (
  select
    jobid,
    jobname,
    schedule,
    active,
    encode(extensions.digest(convert_to(command::text, 'UTF8'), 'sha256'), 'hex') as command_sha256
  from cron.job
  where jobname = 'xrpl-lending-monitor-steady-qualification-minute'
     or command::text ilike '%xrpl-steady-batch-tick%'
), steady_state as (
  select
    count(*) filter (where resource_guard_enabled) as guarded_sessions,
    count(*) filter (where resource_guard_enabled and status = 'running') as running_guarded_sessions,
    count(*) filter (where resource_guard_enabled and status <> 'completed') as noncompleted_guarded_sessions
  from xrpl_steady_v1.sessions
), tick_state as (
  select
    count(*) as total,
    count(*) filter (where status = 'leased') as leased,
    count(*) filter (where status = 'leased' and lease_expires_at > clock_timestamp()) as live_leased
  from xrpl_steady_v1.ticks
), attempt_state as (
  select
    count(*) as total,
    count(*) filter (where status = 'open') as open,
    count(*) filter (where status = 'succeeded') as succeeded,
    count(*) filter (where status = 'failed') as failed,
    count(*) filter (where status = 'deferred') as deferred
  from xrpl_resource_guard_v2.attempts
), transfer_trigger as (
  select
    ns.nspname as table_schema,
    cls.relname as table_name,
    t.tgname as trigger_name,
    t.tgenabled as enabled,
    pns.nspname as function_schema,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_trigger t
  join pg_class cls on cls.oid = t.tgrelid
  join pg_namespace ns on ns.oid = cls.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pns on pns.oid = p.pronamespace
  where not t.tgisinternal
    and (
      t.tgname = 'xrpl_revision3_transfer_after_attempt_finalization'
      or (
        pns.nspname = 'xrpl_resource_guard_v2'
        and p.proname in ('qualify_transfer_after_attempt_finalization', 'qualify_transfer_on_completion')
      )
    )
)
select jsonb_build_object(
  'databaseBytes', pg_database_size(current_database()),
  'targetFunctions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schemaName', schema_name,
      'functionName', function_name,
      'identityArguments', identity_arguments,
      'serviceRoleExecute', service_role_execute,
      'authenticatedExecute', authenticated_execute,
      'anonExecute', anon_execute,
      'sourceSha256', source_sha256
    ) order by schema_name, function_name, identity_arguments)
    from closure_rows
    where depth = 0
  ), '[]'::jsonb),
  'closure', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schemaName', schema_name,
      'functionName', function_name,
      'identityArguments', identity_arguments,
      'depth', depth,
      'dependsOn', depends_on,
      'serviceRoleExecute', service_role_execute,
      'authenticatedExecute', authenticated_execute,
      'anonExecute', anon_execute,
      'sourceSha256', source_sha256
    ) order by depth, schema_name, function_name, identity_arguments, depends_on)
    from closure_rows
  ), '[]'::jsonb),
  'legacyCronJobs', coalesce((select jsonb_agg(to_jsonb(legacy_cron) order by jobid) from legacy_cron), '[]'::jsonb),
  'steadyState', (select to_jsonb(steady_state) from steady_state),
  'tickState', (select to_jsonb(tick_state) from tick_state),
  'attemptState', (select to_jsonb(attempt_state) from attempt_state),
  'transferTriggerBindings', coalesce((select jsonb_agg(to_jsonb(transfer_trigger) order by table_schema, table_name, trigger_name) from transfer_trigger), '[]'::jsonb)
)::text as state;`

if (MUTATION_CAPABILITY.test(SQL)) fail('future-demand audit SQL contains forbidden mutation capability')

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
  fail('future-demand audit state missing')
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
const outputDir = resolve(options['output-dir'] ?? 'r5-revision3-future-demand-readonly-audit')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const state = findState(await managementQuery(SQL))
const targetFunctions = Array.isArray(state.targetFunctions) ? state.targetFunctions : []
const closureRows = Array.isArray(state.closure) ? state.closure : []
const legacyCronJobs = Array.isArray(state.legacyCronJobs) ? state.legacyCronJobs : []
const transferTriggerBindings = Array.isArray(state.transferTriggerBindings)
  ? state.transferTriggerBindings
  : []

const observedTargetNames = new Set(targetFunctions.map((row) => row.functionName))
const missingTargetNames = TARGETS.filter((name) => !observedTargetNames.has(name))
const executableTargets = targetFunctions.filter((row) => row.serviceRoleExecute === true)

const grouped = new Map()
for (const row of closureRows) {
  const key = `${row.schemaName}.${row.functionName}(${row.identityArguments})`
  const current = grouped.get(key) ?? {
    ...row,
    depths: [],
    dependsOn: [],
  }
  current.depths.push(Number(row.depth))
  if (row.dependsOn && !current.dependsOn.includes(row.dependsOn)) current.dependsOn.push(row.dependsOn)
  current.depth = Math.min(...current.depths)
  grouped.set(key, current)
}
const closure = [...grouped.values()].sort(
  (a, b) => a.depth - b.depth || a.functionName.localeCompare(b.functionName),
)
const executableCallers = closure.filter((row) => row.depth > 0 && row.serviceRoleExecute === true)
const outermostExecutableCallers = executableCallers.filter(
  (row) => !closure.some(
    (candidate) => candidate.depth > row.depth && candidate.dependsOn.includes(row.functionName),
  ),
)
const activeLegacyCronJobs = legacyCronJobs.filter((row) => row.active === true)
const liveLeasedTicks = Number(state.tickState?.live_leased ?? 0)
const openAttempts = Number(state.attemptState?.open ?? 0)

const runtimeFutureDemandProvenClosed =
  activeLegacyCronJobs.length === 0
  && executableTargets.length === 0
  && executableCallers.length === 0
  && transferTriggerBindings.length === 0
  && liveLeasedTicks === 0
  && openAttempts === 0

const evidence = {
  schemaVersion: 2,
  purpose: 'r5-revision3-future-demand-readonly-audit',
  sourceCommit,
  querySha256: sha256(SQL),
  databaseBytes: Number(state.databaseBytes),
  targetNames: TARGETS,
  missingTargetNames,
  targetFunctions,
  serviceRoleExecutableTargetCount: executableTargets.length,
  serviceRoleExecutableTargets: executableTargets,
  closureFunctionCount: closure.length,
  serviceRoleExecutableCallerCount: executableCallers.length,
  outermostExecutableCallerCount: outermostExecutableCallers.length,
  outermostExecutableCallers,
  legacyCronJobs,
  activeLegacyCronJobCount: activeLegacyCronJobs.length,
  steadyState: state.steadyState ?? {},
  tickState: state.tickState ?? {},
  attemptState: state.attemptState ?? {},
  transferTriggerBindings,
  runtimeFutureRevision3DemandProvenClosed: runtimeFutureDemandProvenClosed,
  restoreSchemaRemovalProvenSafe: false,
  safety: {
    productionDatabaseReadOnly: true,
    measurementOnly: true,
    permissionMutationAuthorized: false,
    schedulerMutationAuthorized: false,
    functionRetirementAuthorized: false,
    restoreReclaimAuthorized: false,
    schemaMutationAuthorized: false,
    physicalCompactionAuthorized: false,
    deploymentAuthorized: false,
    r5RearmAuthorized: false,
    mainnetDisabled: true,
  },
}

await mkdir(outputDir, { recursive: true })
const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const evidenceSha256 = sha256(serialized)
await writeFile(`${outputDir}/revision3-future-demand-evidence.json`, serialized)
await writeFile(`${outputDir}/revision3-future-demand-evidence.sha256`, `${evidenceSha256}\n`)

const targetLines = targetFunctions.map(
  (row) => `- target: \`${row.schemaName}.${row.functionName}(${row.identityArguments})\`; service_role_execute=\`${row.serviceRoleExecute}\``,
)
const callerLines = outermostExecutableCallers.map(
  (row) => `- outermost executable caller: \`${row.schemaName}.${row.functionName}(${row.identityArguments})\`; depth=\`${row.depth}\``,
)
const cronLines = legacyCronJobs.map(
  (row) => `- legacy cron: id=\`${row.jobid}\`; name=\`${row.jobname}\`; schedule=\`${row.schedule}\`; active=\`${row.active}\`; command_sha256=\`${row.command_sha256}\``,
)
const triggerLines = transferTriggerBindings.map(
  (row) => `- transfer trigger: \`${row.table_schema}.${row.table_name}.${row.trigger_name}\` -> \`${row.function_schema}.${row.function_name}(${row.identity_arguments})\`; enabled=\`${row.enabled}\``,
)
const summary = [
  '## R5 revision-3 runtime future-demand read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${evidence.databaseBytes}\``,
  `- target functions observed / expected: \`${targetFunctions.length} / ${TARGETS.length}\``,
  `- missing target names: \`${missingTargetNames.length}\``,
  `- service-role executable target functions: \`${executableTargets.length}\``,
  `- service-role executable recursive callers: \`${executableCallers.length}\``,
  `- outermost executable callers: \`${outermostExecutableCallers.length}\``,
  `- legacy steady cron jobs / active: \`${legacyCronJobs.length} / ${activeLegacyCronJobs.length}\``,
  `- guarded steady sessions / running / noncompleted: \`${state.steadyState?.guarded_sessions ?? 0} / ${state.steadyState?.running_guarded_sessions ?? 0} / ${state.steadyState?.noncompleted_guarded_sessions ?? 0}\``,
  `- steady ticks total / leased / live leased: \`${state.tickState?.total ?? 0} / ${state.tickState?.leased ?? 0} / ${state.tickState?.live_leased ?? 0}\``,
  `- revision-3 attempts total / open / succeeded / failed / deferred: \`${state.attemptState?.total ?? 0} / ${state.attemptState?.open ?? 0} / ${state.attemptState?.succeeded ?? 0} / ${state.attemptState?.failed ?? 0} / ${state.attemptState?.deferred ?? 0}\``,
  `- transfer qualification trigger bindings: \`${transferTriggerBindings.length}\``,
  `- runtime future revision-3 demand proven closed: \`${runtimeFutureDemandProvenClosed}\``,
  '- restore schema removal proven safe: `false`',
  '',
  ...targetLines,
  ...callerLines,
  ...cronLines,
  ...triggerLines,
  '',
  'This is a runtime reachability measurement only. A false closure verdict identifies the remaining rev3 execution surface; a true verdict proves closure only for the measured service-role/trigger/pg_cron runtime boundary. It does not itself authorize permission retirement, scheduler changes, restore reclaim/removal, physical compaction, deployment, R5 rearm, or Mainnet.',
  '',
  `Evidence SHA-256: \`${evidenceSha256}\``,
].join('\n')
await writeFile(`${outputDir}/revision3-future-demand-summary.md`, `${summary}\n`)
console.log(summary)
