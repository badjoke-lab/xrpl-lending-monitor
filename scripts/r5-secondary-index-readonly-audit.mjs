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
with collector_status as (
  select status, count(*)::bigint as rows
  from public.xrpl_collector_runs
  where profile_id='supabase-devnet'
  group by status
), collector_span as (
  select
    count(*)::bigint as rows,
    min(completed_at) as oldest_completed_at,
    max(completed_at) as newest_completed_at,
    count(*) filter (where completed_at < now()-interval '24 hours')::bigint as older_than_24h,
    count(*) filter (where completed_at < now()-interval '7 days')::bigint as older_than_7d
  from public.xrpl_collector_runs
  where profile_id='supabase-devnet'
), collector_consumers as (
  select n.nspname as schema_name,p.proname as function_name,
         pg_get_function_identity_arguments(p.oid) as identity_arguments,
         pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','xrpl_r5_v1')
    and p.prokind='f'
    and p.prosrc ilike '%xrpl_collector_runs%'
), collector_views as (
  select schemaname as schema_name,viewname as view_name,definition
  from pg_views
  where schemaname in ('public','xrpl_r5_v1')
    and definition ilike '%xrpl_collector_runs%'
), committed_groups as (
  select profile_id,network,epoch_id,base_identity,count(*)::bigint as rows
  from public.xrpl_phase_work
  where status='committed'
  group by profile_id,network,epoch_id,base_identity
), statement_extension as (
  select n.nspname as schema_name
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pg_stat_statements'
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'databaseHeadroomBytes',400000000-pg_database_size(current_database()),
  'collectorStatusCounts',coalesce((select jsonb_agg(to_jsonb(x) order by x.status) from collector_status x),'[]'::jsonb),
  'collectorSpan',(select to_jsonb(x) from collector_span x),
  'collectorConsumers',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.function_name,x.identity_arguments) from collector_consumers x),'[]'::jsonb),
  'collectorViews',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.view_name) from collector_views x),'[]'::jsonb),
  'committedIdentityGroups',coalesce((select jsonb_agg(to_jsonb(x) order by x.profile_id,x.network,x.epoch_id,x.base_identity) from committed_groups x),'[]'::jsonb),
  'collectorIndex',(select jsonb_build_object(
      'definition',pg_get_indexdef(i.indexrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),
      'bytes',pg_relation_size(i.indexrelid),'idxScan',coalesce(s.idx_scan,0),
      'idxTupRead',coalesce(s.idx_tup_read,0),'idxTupFetch',coalesce(s.idx_tup_fetch,0),
      'constraintBacked',exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
    ) from pg_index i left join pg_stat_all_indexes s on s.indexrelid=i.indexrelid
    where i.indexrelid='public.xrpl_collector_runs_profile_completed_idx'::regclass),
  'committedReaderIndex',(select jsonb_build_object(
      'definition',pg_get_indexdef(i.indexrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),
      'bytes',pg_relation_size(i.indexrelid),'idxScan',coalesce(s.idx_scan,0),
      'idxTupRead',coalesce(s.idx_tup_read,0),'idxTupFetch',coalesce(s.idx_tup_fetch,0),
      'constraintBacked',exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
    ) from pg_index i left join pg_stat_all_indexes s on s.indexrelid=i.indexrelid
    where i.indexrelid='public.xrpl_phase_work_committed_reader_idx'::regclass),
  'statsReset',(select stats_reset from pg_stat_database where datname=current_database()),
  'pgStatStatementsSchema',(select schema_name from statement_extension limit 1),
  'safetyBoundary',jsonb_build_object(
    'readOnly',true,'noIndexMutationAuthorized',true,'noRowMutationAuthorized',true,
    'noVacuumAuthorized',true,'noSchedulerMutationAuthorized',true,'noDeploymentAuthorized',true,
    'mainnetDisabled',true
  )
)::text as state;`

const PLANS = Object.freeze({
  collectorLatest: "explain (format json,costs off) select id,status,completed_at from public.xrpl_collector_runs where profile_id='supabase-devnet' order by completed_at desc,id desc limit 20",
  collectorRecent24h: "explain (format json,costs off) select id,status,completed_at from public.xrpl_collector_runs where profile_id='supabase-devnet' and completed_at>=now()-interval '24 hours' order by completed_at desc,id desc limit 20",
  collectorFailedLatest: "explain (format json,costs off) select id,status,completed_at from public.xrpl_collector_runs where profile_id='supabase-devnet' and status='failed' order by completed_at desc,id desc limit 20",
  collectorId: "explain (format json,costs off) select * from public.xrpl_collector_runs where id=(select max(id) from public.xrpl_collector_runs)",
  committedReader: "explain (format json,costs off) select work_id,scanned_end_ledger_index from public.xrpl_phase_work where profile_id='supabase-devnet' and network='devnet' and epoch_id=(select epoch_id from public.xrpl_phase_streams where profile_id='supabase-devnet') and base_identity=(select base_identity from public.xrpl_phase_streams where profile_id='supabase-devnet') and status='committed' order by scanned_end_ledger_index desc,work_id desc limit 20",
  committedForward: "explain (format json,costs off) select work_id,scanned_end_ledger_index from public.xrpl_phase_work where profile_id='supabase-devnet' and network='devnet' and epoch_id=(select epoch_id from public.xrpl_phase_streams where profile_id='supabase-devnet') and base_identity=(select base_identity from public.xrpl_phase_streams where profile_id='supabase-devnet') and status='committed' and scanned_end_ledger_index>0 order by scanned_end_ledger_index,work_id limit 20",
})

for (const [name, query] of Object.entries({ AUDIT_SQL, ...PLANS })) {
  if (MUTATION_CAPABILITY.test(query)) fail(`read-only secondary-index SQL contains mutation capability: ${name}`)
}

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
  if (!response.ok) fail(`Management API query failed: ${response.status}`)
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
for (const key of ['readOnly','noIndexMutationAuthorized','noRowMutationAuthorized','noVacuumAuthorized','noSchedulerMutationAuthorized','noDeploymentAuthorized','mainnetDisabled']) {
  if (state.safetyBoundary?.[key]!==true) fail(`missing safety boundary: ${key}`)
}
const plans={}
for (const [name,sql] of Object.entries(PLANS)) plans[name]=oneColumn(await query(sql),`plan ${name}`)

let collectorStatements=[]
let committedReaderStatements=[]
const statementSchema=state.pgStatStatementsSchema
if (statementSchema!=null) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(statementSchema)) fail('invalid pg_stat_statements schema')
  const collectorSql=`select query,calls::bigint as calls,rows::bigint as rows,mean_exec_time from ${statementSchema}.pg_stat_statements where query ilike '%xrpl_collector_runs%' order by calls desc limit 100`
  const committedSql=`select query,calls::bigint as calls,rows::bigint as rows,mean_exec_time from ${statementSchema}.pg_stat_statements where query ilike '%xrpl_phase_work%' and query ilike '%scanned_end_ledger_index%' and query ilike '%committed%' order by calls desc limit 100`
  if (MUTATION_CAPABILITY.test(collectorSql)||MUTATION_CAPABILITY.test(committedSql)) fail('statement audit contains mutation capability')
  collectorStatements=await query(collectorSql)
  committedReaderStatements=await query(committedSql)
}

const evidence={
  sourceCommit,
  querySha256:createHash('sha256').update([AUDIT_SQL,...Object.values(PLANS)].join('\n--next--\n')).digest('hex'),
  state,plans,collectorStatements,committedReaderStatements,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/secondary-evidence.json`,serialized)
await writeFile(`${outputDir}/secondary-evidence.sha256`,`${digest}\n`)

const planText=(name)=>JSON.stringify(plans[name]??{})
const summary=[
  '## Secondary index read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes/headroom: \`${state.databaseBytes} / ${state.databaseHeadroomBytes}\``,
  `- stats reset: \`${state.statsReset??'null'}\``,
  `- collector index bytes/scans: \`${state.collectorIndex?.bytes??'null'} / ${state.collectorIndex?.idxScan??'null'}\``,
  `- committed-reader index bytes/scans: \`${state.committedReaderIndex?.bytes??'null'} / ${state.committedReaderIndex?.idxScan??'null'}\``,
  `- collector rows older than 24h / 7d: \`${state.collectorSpan?.older_than_24h??'null'} / ${state.collectorSpan?.older_than_7d??'null'}\``,
  `- collector functions/views: \`${state.collectorConsumers?.length??0} / ${state.collectorViews?.length??0}\``,
  `- pg_stat_statements collector / committed-reader matches: \`${collectorStatements.length} / ${committedReaderStatements.length}\``,
  `- collector latest plan uses collector index: \`${planText('collectorLatest').includes('xrpl_collector_runs_profile_completed_idx')}\``,
  `- collector recent-24h plan uses collector index: \`${planText('collectorRecent24h').includes('xrpl_collector_runs_profile_completed_idx')}\``,
  `- committed reader plan uses dedicated index: \`${planText('committedReader').includes('xrpl_phase_work_committed_reader_idx')}\``,
  `- committed forward plan uses dedicated index: \`${planText('committedForward').includes('xrpl_phase_work_committed_reader_idx')}\``,
  '- production mutation: `false`',
  '',
  'Collector status counts:',
  ...(state.collectorStatusCounts??[]).map(x=>`- \`${x.status}\`: ${x.rows}`),
  '',
  'Committed identity groups:',
  ...(state.committedIdentityGroups??[]).map(x=>`- \`${x.profile_id}/${x.network}/${x.epoch_id}/${x.base_identity}\`: ${x.rows}`),
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/secondary-summary.md`,`${summary}\n`)
console.log(summary)
