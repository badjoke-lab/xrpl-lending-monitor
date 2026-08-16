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

const SQL = String.raw`
select jsonb_build_object(
  'databaseBytes', pg_database_size(current_database()),
  'consumers', coalesce(jsonb_agg(jsonb_build_object(
    'schemaName', n.nspname,
    'functionName', p.proname,
    'identityArguments', pg_get_function_identity_arguments(p.oid),
    'sourceSha256', encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),
    'sourceBytes', octet_length(p.prosrc),
    'serviceRoleExecute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
    'usesMessages', strpos(lower(p.prosrc),'xrpl_phase_messages') > 0,
    'usesSuccessors', strpos(lower(p.prosrc),'xrpl_phase_successors') > 0,
    'messageInsert', strpos(lower(p.prosrc),'insert into public.xrpl_phase_messages') > 0,
    'messageUpdate', strpos(lower(p.prosrc),'update public.xrpl_phase_messages') > 0,
    'messageDelete', strpos(lower(p.prosrc),'delete from public.xrpl_phase_messages') > 0,
    'successorInsert', strpos(lower(p.prosrc),'insert into public.xrpl_phase_successors') > 0,
    'successorUpdate', strpos(lower(p.prosrc),'update public.xrpl_phase_successors') > 0,
    'successorDelete', strpos(lower(p.prosrc),'delete from public.xrpl_phase_successors') > 0,
    'readsPayload', strpos(lower(p.prosrc),'payload') > 0,
    'readsResult', strpos(lower(p.prosrc),'result') > 0,
    'readsSuccessorMessageId', strpos(lower(p.prosrc),'successor_message_id') > 0,
    'mentionsCompleted', strpos(lower(p.prosrc),'''completed''') > 0,
    'mentionsPending', strpos(lower(p.prosrc),'''pending''') > 0,
    'mentionsRetry', strpos(lower(p.prosrc),'''retry''') > 0,
    'mentionsLeased', strpos(lower(p.prosrc),'''leased''') > 0,
    'callsPhaseInsertMessage', strpos(lower(p.prosrc),'xrpl_phase_insert_message') > 0,
    'callsPhaseReserveSuccessor', strpos(lower(p.prosrc),'xrpl_phase_reserve_successor') > 0,
    'usesJsonAggregation', strpos(lower(p.prosrc),'jsonb_agg') > 0 or strpos(lower(p.prosrc),'json_agg') > 0,
    'usesCount', strpos(lower(p.prosrc),'count(') > 0,
    'usesDigest', strpos(lower(p.prosrc),'digest(') > 0
  ) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb),
  'safetyBoundary', jsonb_build_object(
    'readOnly', true,
    'noRowMutationAuthorized', true,
    'noIndexMutationAuthorized', true,
    'noVacuumAuthorized', true,
    'noSchedulerMutationAuthorized', true,
    'noDeploymentAuthorized', true,
    'noR5RestartAuthorized', true,
    'mainnetDisabled', true
  )
)::text as state
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','xrpl_r5_v1')
  and p.prokind='f'
  and (p.prosrc ilike '%xrpl_phase_messages%' or p.prosrc ilike '%xrpl_phase_successors%');`

if (!/^\s*select\b/iu.test(SQL)) fail('consumer audit must be one SELECT statement')
if (/\b(delete\s+from|truncate|vacuum|alter\s+table|drop\s+table|create\s+table|reindex)\b/iu.test(SQL.replace(/'[^']*'/gu, "''"))) {
  fail('consumer audit SQL contains mutation capability')
}

async function query(sql) {
  const projectId=requireEnv('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u)
  const token=requireEnv('SUPABASE_ACCESS_TOKEN')
  const response=await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:true}),
    signal:AbortSignal.timeout(60000),
  })
  const text=await response.text()
  let body
  try { body=JSON.parse(text) } catch { fail(`non-json Management API response: ${text.slice(0,500)}`) }
  if (!response.ok) fail(`Management API query failed: ${response.status} ${text.slice(0,500)}`)
  return body
}
function oneColumn(rows) {
  if (!Array.isArray(rows)||rows.length<1) fail('empty consumer audit')
  const keys=Object.keys(rows[0]??{})
  if (keys.length!==1) fail('unexpected consumer audit shape')
  return rows[0][keys[0]]
}

const CORE_ARCHIVE_NAMES = new Set([
  'xrpl_phase_insert_message',
  'xrpl_phase_reserve_successor',
  'xrpl_complete_caught_up_scan',
  'xrpl_complete_scan_phase',
  'xrpl_complete_commit_phase',
  'xrpl_complete_finalize_phase',
  'xrpl_complete_portable_scan_phase',
  'xrpl_complete_portable_commit_phase_strict',
  'xrpl_complete_portable_finalize_phase',
])
const CURRENT_R5_PREFIXES = [
  'xrpl_claim_r5_revision4_',
  'xrpl_complete_r5_revision4_',
  'xrpl_prepare_r5_revision4_',
  'xrpl_rebind_r5_revision4_',
]
const SNAPSHOT_PATTERNS = [
  /^xrpl_build_/u,
  /^xrpl_restore_/u,
  /^xrpl_read_/u,
  /^xrpl_create_r5_active_checkpoint/u,
  /^xrpl_prepare_r5_active_recovery/u,
  /^xrpl_rebind_r5_prebatch_/u,
  /^xrpl_read_throughput_resource_baseline$/u,
]
const FAULT_PATTERNS = [
  /remote_fault/u,
  /restored_continuation/u,
  /multichunk_witness/u,
]

function classify(c) {
  const name=String(c.functionName)
  if (CORE_ARCHIVE_NAMES.has(name)) return 'archive_semantics_required'
  if (CURRENT_R5_PREFIXES.some((prefix)=>name.startsWith(prefix))) return 'current_r5_compat_required'
  if (SNAPSHOT_PATTERNS.some((pattern)=>pattern.test(name))) return 'historical_snapshot_or_restore_review'
  if (FAULT_PATTERNS.some((pattern)=>pattern.test(name))) return 'historical_qualification_review'
  if (name==='xrpl_claim_next_phase') return 'active_queue_terminal_rows_not_claimable'
  if (['xrpl_retry_phase_message','xrpl_fail_phase_terminal'].includes(name)) return 'active_lease_terminal_rows_not_mutable'
  if (c.messageDelete===true || c.successorDelete===true) return 'unexpected_delete_consumer_blocker'
  if (c.messageInsert===true || c.messageUpdate===true || c.successorInsert===true || c.successorUpdate===true) return 'direct_transport_mutator_review'
  if (c.usesJsonAggregation===true || c.usesCount===true || c.usesDigest===true) return 'aggregate_state_review'
  return 'manual_review'
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
const consumers=(state.consumers??[]).map((consumer)=>({...consumer,classification:classify(consumer)}))
const counts={}
for (const c of consumers) counts[c.classification]=(counts[c.classification]??0)+1
const blockers=consumers.filter((c)=>['unexpected_delete_consumer_blocker','manual_review','direct_transport_mutator_review','aggregate_state_review'].includes(c.classification))
const evidence={
  sourceCommit,
  querySha256:createHash('sha256').update(SQL).digest('hex'),
  databaseBytes:Number(state.databaseBytes),
  consumerCount:consumers.length,
  classificationCounts:counts,
  consumers,
  unresolvedBlockerCount:blockers.length,
  safetyBoundary:state.safetyBoundary,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/transport-consumer-compat-evidence.json`,serialized)
await writeFile(`${outputDir}/transport-consumer-compat-evidence.sha256`,`${digest}\n`)
const summary=[
  '## Phase transport consumer compatibility read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${state.databaseBytes}\``,
  `- consumer functions: \`${consumers.length}\``,
  `- archive semantics required: \`${counts.archive_semantics_required??0}\``,
  `- current R5 compatibility required: \`${counts.current_r5_compat_required??0}\``,
  `- historical snapshot/restore review: \`${counts.historical_snapshot_or_restore_review??0}\``,
  `- historical qualification review: \`${counts.historical_qualification_review??0}\``,
  `- active queue terminal rows not claimable: \`${counts.active_queue_terminal_rows_not_claimable??0}\``,
  `- active lease terminal rows not mutable: \`${counts.active_lease_terminal_rows_not_mutable??0}\``,
  `- unresolved direct/aggregate/manual blockers: \`${blockers.length}\``,
  `- service-role executable consumers: \`${consumers.filter((c)=>c.serviceRoleExecute===true).length}\``,
  `- direct message/successor delete consumers: \`${consumers.filter((c)=>c.messageDelete===true||c.successorDelete===true).length}\``,
  '- production mutation: `false`',
  '',
  'Unresolved blockers:',
  ...(blockers.length?blockers.map((c)=>`- \`${c.functionName}(${c.identityArguments})\`: ${c.classification}; source=${c.sourceSha256}`):['- none']),
  '',
  'Current R5 compatibility-required functions:',
  ...consumers.filter((c)=>c.classification==='current_r5_compat_required').map((c)=>`- \`${c.functionName}(${c.identityArguments})\`; source=${c.sourceSha256}`),
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/transport-consumer-compat-summary.md`,`${summary}\n`)
console.log(summary)
