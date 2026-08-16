import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) { throw new Error(message) }
function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const value = args[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${key ?? '<end>'}`)
    out[key.slice(2)] = value
  }
  return out
}

const MUTATION_CAPABILITY = /\b(delete|update|insert|alter|drop|truncate|vacuum|create|grant|revoke|refresh|cluster|reindex)\b/iu
const AUDIT_SQL = String.raw`
with message_status as (
  select status,count(*)::bigint as rows
  from public.xrpl_phase_messages
  group by status
), message_span as (
  select
    count(*)::bigint as total_rows,
    count(*) filter (where status='completed')::bigint as completed_rows,
    count(*) filter (where status='completed' and completed_at < now()-interval '24 hours')::bigint as completed_older_24h,
    count(*) filter (where status='completed' and completed_at < now()-interval '7 days')::bigint as completed_older_7d,
    count(*) filter (where status in ('pending','leased','retry'))::bigint as live_queue_rows,
    count(*) filter (where status='error')::bigint as error_rows,
    coalesce(sum(pg_column_size(m)) filter (where status='completed' and completed_at < now()-interval '24 hours'),0)::bigint as completed_older_24h_logical_bytes,
    coalesce(sum(pg_column_size(m)) filter (where status='completed' and completed_at < now()-interval '7 days'),0)::bigint as completed_older_7d_logical_bytes
  from public.xrpl_phase_messages m
), successor_span as (
  select
    count(*)::bigint as total_rows,
    count(*) filter (where cm.status='completed' and sm.status='completed')::bigint as both_completed_rows,
    count(*) filter (where cm.status='completed' and sm.status='completed' and cm.completed_at < now()-interval '24 hours' and sm.completed_at < now()-interval '24 hours')::bigint as both_completed_older_24h,
    count(*) filter (where cm.status='completed' and sm.status='completed' and cm.completed_at < now()-interval '7 days' and sm.completed_at < now()-interval '7 days')::bigint as both_completed_older_7d,
    coalesce(sum(pg_column_size(s)) filter (where cm.status='completed' and sm.status='completed' and cm.completed_at < now()-interval '24 hours' and sm.completed_at < now()-interval '24 hours'),0)::bigint as both_completed_older_24h_logical_bytes,
    coalesce(sum(pg_column_size(s)) filter (where cm.status='completed' and sm.status='completed' and cm.completed_at < now()-interval '7 days' and sm.completed_at < now()-interval '7 days'),0)::bigint as both_completed_older_7d_logical_bytes
  from public.xrpl_phase_successors s
  join public.xrpl_phase_messages cm on cm.message_id=s.current_message_id
  join public.xrpl_phase_messages sm on sm.message_id=s.successor_message_id
), message_consumers as (
  select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','xrpl_r5_v1') and p.prokind='f' and p.prosrc ilike '%xrpl_phase_messages%'
), successor_consumers as (
  select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','xrpl_r5_v1') and p.prokind='f' and p.prosrc ilike '%xrpl_phase_successors%'
), transport_views as (
  select schemaname as schema_name,viewname as view_name
  from pg_views
  where schemaname in ('public','xrpl_r5_v1') and (definition ilike '%xrpl_phase_messages%' or definition ilike '%xrpl_phase_successors%')
), transport_fks as (
  select
    c.conname as constraint_name,
    c.conrelid::regclass::text as referencing_table,
    c.confrelid::regclass::text as referenced_table,
    pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  where c.contype='f' and (
    c.conrelid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass)
    or c.confrelid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass)
  )
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'databaseHeadroomBytes',400000000-pg_database_size(current_database()),
  'messageTableBytes',pg_total_relation_size('public.xrpl_phase_messages'::regclass),
  'messageHeapBytes',pg_relation_size('public.xrpl_phase_messages'::regclass),
  'messageIndexBytes',pg_indexes_size('public.xrpl_phase_messages'::regclass),
  'successorTableBytes',pg_total_relation_size('public.xrpl_phase_successors'::regclass),
  'successorHeapBytes',pg_relation_size('public.xrpl_phase_successors'::regclass),
  'successorIndexBytes',pg_indexes_size('public.xrpl_phase_successors'::regclass),
  'messageStatusCounts',coalesce((select jsonb_agg(to_jsonb(x) order by x.status) from message_status x),'[]'::jsonb),
  'messageSpan',(select to_jsonb(x) from message_span x),
  'successorSpan',(select to_jsonb(x) from successor_span x),
  'messageConsumers',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.function_name,x.identity_arguments) from message_consumers x),'[]'::jsonb),
  'successorConsumers',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.function_name,x.identity_arguments) from successor_consumers x),'[]'::jsonb),
  'transportViews',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.view_name) from transport_views x),'[]'::jsonb),
  'transportForeignKeys',coalesce((select jsonb_agg(to_jsonb(x) order by x.referencing_table,x.constraint_name) from transport_fks x),'[]'::jsonb),
  'canonicalTablesReferenceMessagesOrSuccessors',exists(
    select 1 from pg_constraint c
    where c.contype='f'
      and c.conrelid in ('public.xrpl_phase_work'::regclass,'public.xrpl_phase_reference_rows'::regclass,'public.xrpl_phase_watermarks'::regclass)
      and c.confrelid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass)
  ),
  'safetyBoundary',jsonb_build_object(
    'readOnly',true,'noRowMutationAuthorized',true,'noIndexMutationAuthorized',true,
    'noVacuumAuthorized',true,'noSchedulerMutationAuthorized',true,'noDeploymentAuthorized',true,
    'noR5RestartAuthorized',true,'mainnetDisabled',true
  )
)::text as state;`

if (MUTATION_CAPABILITY.test(AUDIT_SQL)) fail('transport audit SQL contains mutation capability')

async function query(sql) {
  const projectId=requireEnv('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u)
  const token=requireEnv('SUPABASE_ACCESS_TOKEN')
  const response=await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(60000),
  })
  const text=await response.text()
  let body
  try { body=JSON.parse(text) } catch { fail(`non-json Management API response: ${text.slice(0,500)}`) }
  if (!response.ok) fail(`Management API query failed: ${response.status} ${text.slice(0,500)}`)
  return body
}
function oneColumn(rows,label) {
  if (!Array.isArray(rows)||rows.length<1) fail(`empty ${label}`)
  const keys=Object.keys(rows[0]??{})
  if (keys.length!==1) fail(`unexpected ${label} shape`)
  return rows[0][keys[0]]
}
function stateFrom(rows) {
  const raw=oneColumn(rows,'audit')
  return typeof raw==='string'?JSON.parse(raw):raw
}

const options=parseArgs(process.argv.slice(2))
const sourceCommit=options['source-commit']
const outputDir=resolve(options['output-dir']??'r5-index-footprint-readonly-probe')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit')

const state=stateFrom(await query(AUDIT_SQL))
for (const key of ['readOnly','noRowMutationAuthorized','noIndexMutationAuthorized','noVacuumAuthorized','noSchedulerMutationAuthorized','noDeploymentAuthorized','noR5RestartAuthorized','mainnetDisabled']) {
  if (state.safetyBoundary?.[key]!==true) fail(`missing safety boundary: ${key}`)
}
const evidence={sourceCommit,querySha256:createHash('sha256').update(AUDIT_SQL).digest('hex'),state}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/transport-evidence.json`,serialized)
await writeFile(`${outputDir}/transport-evidence.sha256`,`${digest}\n`)

const m=state.messageSpan??{}
const s=state.successorSpan??{}
const summary=[
  '## Phase transport retention read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes/headroom: \`${state.databaseBytes} / ${state.databaseHeadroomBytes}\``,
  `- message table total/heap/index bytes: \`${state.messageTableBytes} / ${state.messageHeapBytes} / ${state.messageIndexBytes}\``,
  `- successor table total/heap/index bytes: \`${state.successorTableBytes} / ${state.successorHeapBytes} / ${state.successorIndexBytes}\``,
  `- completed messages total / >24h / >7d: \`${m.completed_rows??0} / ${m.completed_older_24h??0} / ${m.completed_older_7d??0}\``,
  `- live queue / error messages: \`${m.live_queue_rows??0} / ${m.error_rows??0}\``,
  `- completed message logical bytes >24h / >7d: \`${m.completed_older_24h_logical_bytes??0} / ${m.completed_older_7d_logical_bytes??0}\``,
  `- successor rows total / both-completed >24h / >7d: \`${s.total_rows??0} / ${s.both_completed_older_24h??0} / ${s.both_completed_older_7d??0}\``,
  `- successor logical bytes >24h / >7d: \`${s.both_completed_older_24h_logical_bytes??0} / ${s.both_completed_older_7d_logical_bytes??0}\``,
  `- message/successor consumer functions: \`${state.messageConsumers?.length??0} / ${state.successorConsumers?.length??0}\``,
  `- transport views: \`${state.transportViews?.length??0}\``,
  `- transport foreign keys: \`${state.transportForeignKeys?.length??0}\``,
  `- canonical work/reference/watermark FK into transport tables: \`${state.canonicalTablesReferenceMessagesOrSuccessors===true}\``,
  '- production mutation: `false`',
  '',
  'Message status counts:',
  ...(state.messageStatusCounts??[]).map(x=>`- \`${x.status}\`: ${x.rows}`),
  '',
  'Foreign-key edges:',
  ...(state.transportForeignKeys??[]).map(x=>`- \`${x.referencing_table}\` -> \`${x.referenced_table}\`: ${x.constraint_name}`),
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/transport-summary.md`,`${summary}\n`)
console.log(summary)
