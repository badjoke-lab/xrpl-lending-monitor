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
const SQL = String.raw`
with eligible_messages as (
  select *
  from public.xrpl_phase_messages
  where status='completed' and completed_at < now()-interval '24 hours'
), message_shape as (
  select
    count(*)::bigint as rows,
    min(completed_at) as oldest_completed_at,
    max(completed_at) as newest_completed_at,
    min(octet_length(message_id))::bigint as min_message_id_bytes,
    max(octet_length(message_id))::bigint as max_message_id_bytes,
    avg(octet_length(message_id))::numeric as avg_message_id_bytes,
    coalesce(sum(pg_column_size(m)),0)::bigint as row_storage_bytes,
    coalesce(sum(pg_column_size(message_id)),0)::bigint as message_id_storage_bytes,
    coalesce(sum(pg_column_size(profile_id)),0)::bigint as profile_id_storage_bytes,
    coalesce(sum(pg_column_size(phase)),0)::bigint as phase_storage_bytes,
    coalesce(sum(pg_column_size(payload)),0)::bigint as payload_storage_bytes,
    coalesce(sum(octet_length(payload::text)),0)::bigint as payload_text_bytes,
    coalesce(sum(pg_column_size(result)),0)::bigint as result_storage_bytes,
    coalesce(sum(octet_length(result::text)),0)::bigint as result_text_bytes,
    coalesce(sum(pg_column_size(successor_message_id)),0)::bigint as successor_id_storage_bytes,
    count(*) filter (where result is not null)::bigint as rows_with_result,
    count(*) filter (where successor_message_id is not null)::bigint as rows_with_successor
  from eligible_messages m
), message_groups as (
  select
    profile_id,
    phase,
    count(*)::bigint as rows,
    coalesce(sum(pg_column_size(m)),0)::bigint as row_storage_bytes,
    coalesce(sum(pg_column_size(payload)),0)::bigint as payload_storage_bytes,
    coalesce(sum(pg_column_size(result)),0)::bigint as result_storage_bytes,
    coalesce(sum(pg_column_size(message_id)),0)::bigint as message_id_storage_bytes,
    coalesce(sum(pg_column_size(successor_message_id)),0)::bigint as successor_id_storage_bytes
  from eligible_messages m
  group by profile_id,phase
), eligible_successors as (
  select s.*
  from public.xrpl_phase_successors s
  join public.xrpl_phase_messages cm on cm.message_id=s.current_message_id
  join public.xrpl_phase_messages sm on sm.message_id=s.successor_message_id
  where cm.status='completed' and sm.status='completed'
    and cm.completed_at < now()-interval '24 hours'
    and sm.completed_at < now()-interval '24 hours'
), successor_shape as (
  select
    count(*)::bigint as rows,
    min(octet_length(current_message_id))::bigint as min_current_id_bytes,
    max(octet_length(current_message_id))::bigint as max_current_id_bytes,
    avg(octet_length(current_message_id))::numeric as avg_current_id_bytes,
    min(octet_length(successor_message_id))::bigint as min_successor_id_bytes,
    max(octet_length(successor_message_id))::bigint as max_successor_id_bytes,
    avg(octet_length(successor_message_id))::numeric as avg_successor_id_bytes,
    coalesce(sum(pg_column_size(s)),0)::bigint as row_storage_bytes,
    coalesce(sum(pg_column_size(current_message_id)),0)::bigint as current_id_storage_bytes,
    coalesce(sum(pg_column_size(successor_message_id)),0)::bigint as successor_id_storage_bytes
  from eligible_successors s
), cutoff_edges as (
  select
    count(*) filter (
      where cm.status='completed' and cm.completed_at < now()-interval '24 hours'
        and not (sm.status='completed' and sm.completed_at < now()-interval '24 hours')
    )::bigint as old_current_to_retained_successor,
    count(*) filter (
      where sm.status='completed' and sm.completed_at < now()-interval '24 hours'
        and not (cm.status='completed' and cm.completed_at < now()-interval '24 hours')
    )::bigint as retained_current_to_old_successor
  from public.xrpl_phase_successors s
  join public.xrpl_phase_messages cm on cm.message_id=s.current_message_id
  join public.xrpl_phase_messages sm on sm.message_id=s.successor_message_id
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'databaseHeadroomBytes',400000000-pg_database_size(current_database()),
  'messageTableBytes',pg_total_relation_size('public.xrpl_phase_messages'::regclass),
  'successorTableBytes',pg_total_relation_size('public.xrpl_phase_successors'::regclass),
  'messageShape',(select to_jsonb(x) from message_shape x),
  'messageGroups',coalesce((select jsonb_agg(to_jsonb(x) order by x.rows desc,x.profile_id,x.phase) from message_groups x),'[]'::jsonb),
  'successorShape',(select to_jsonb(x) from successor_shape x),
  'cutoffEdges',(select to_jsonb(x) from cutoff_edges x),
  'safetyBoundary',jsonb_build_object(
    'readOnly',true,'noRowMutationAuthorized',true,'noIndexMutationAuthorized',true,
    'noVacuumAuthorized',true,'noSchedulerMutationAuthorized',true,'noDeploymentAuthorized',true,
    'noR5RestartAuthorized',true,'mainnetDisabled',true
  )
)::text as state;`

if (MUTATION_CAPABILITY.test(SQL)) fail('transport compaction shape SQL contains mutation capability')

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
function oneColumn(rows) {
  if (!Array.isArray(rows)||rows.length<1) fail('empty audit')
  const keys=Object.keys(rows[0]??{})
  if (keys.length!==1) fail('unexpected audit shape')
  return rows[0][keys[0]]
}

const options=parseArgs(process.argv.slice(2))
const sourceCommit=options['source-commit']
const outputDir=resolve(options['output-dir']??'r5-index-footprint-readonly-probe')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit')
const raw=oneColumn(await query(SQL))
const state=typeof raw==='string'?JSON.parse(raw):raw
for (const key of ['readOnly','noRowMutationAuthorized','noIndexMutationAuthorized','noVacuumAuthorized','noSchedulerMutationAuthorized','noDeploymentAuthorized','noR5RestartAuthorized','mainnetDisabled']) {
  if (state.safetyBoundary?.[key]!==true) fail(`missing safety boundary: ${key}`)
}
const evidence={sourceCommit,querySha256:createHash('sha256').update(SQL).digest('hex'),state}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/transport-shape-evidence.json`,serialized)
await writeFile(`${outputDir}/transport-shape-evidence.sha256`,`${digest}\n`)
const m=state.messageShape??{}
const s=state.successorShape??{}
const c=state.cutoffEdges??{}
const summary=[
  '## Phase transport compaction shape read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes/headroom: \`${state.databaseBytes} / ${state.databaseHeadroomBytes}\``,
  `- eligible completed messages >24h: \`${m.rows??0}\``,
  `- eligible message row/payload/result bytes: \`${m.row_storage_bytes??0} / ${m.payload_storage_bytes??0} / ${m.result_storage_bytes??0}\``,
  `- eligible message payload/result text bytes: \`${m.payload_text_bytes??0} / ${m.result_text_bytes??0}\``,
  `- eligible message id/successor-id bytes: \`${m.message_id_storage_bytes??0} / ${m.successor_id_storage_bytes??0}\``,
  `- message-id bytes min/avg/max: \`${m.min_message_id_bytes??0} / ${m.avg_message_id_bytes??0} / ${m.max_message_id_bytes??0}\``,
  `- eligible successor rows: \`${s.rows??0}\``,
  `- eligible successor row/current-id/successor-id bytes: \`${s.row_storage_bytes??0} / ${s.current_id_storage_bytes??0} / ${s.successor_id_storage_bytes??0}\``,
  `- current-id bytes min/avg/max: \`${s.min_current_id_bytes??0} / ${s.avg_current_id_bytes??0} / ${s.max_current_id_bytes??0}\``,
  `- successor-id bytes min/avg/max: \`${s.min_successor_id_bytes??0} / ${s.avg_successor_id_bytes??0} / ${s.max_successor_id_bytes??0}\``,
  `- cutoff-crossing edges old->retained / retained->old: \`${c.old_current_to_retained_successor??0} / ${c.retained_current_to_old_successor??0}\``,
  '- production mutation: `false`',
  '',
  'Eligible completed messages by profile/phase:',
  ...(state.messageGroups??[]).map(x=>`- \`${x.profile_id}/${x.phase}\`: rows=${x.rows}, row=${x.row_storage_bytes}B, payload=${x.payload_storage_bytes}B, result=${x.result_storage_bytes}B`),
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/transport-shape-summary.md`,`${summary}\n`)
console.log(summary)
