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

const TARGETS = [
  ['archive_semantics_required','public','xrpl_phase_insert_message'],
  ['archive_semantics_required','public','xrpl_phase_reserve_successor'],
  ['archive_semantics_required','public','xrpl_complete_caught_up_scan'],
  ['archive_semantics_required','public','xrpl_complete_scan_phase'],
  ['archive_semantics_required','public','xrpl_complete_commit_phase'],
  ['archive_semantics_required','public','xrpl_complete_finalize_phase'],
  ['archive_semantics_required','public','xrpl_complete_portable_scan_phase'],
  ['archive_semantics_required','public','xrpl_complete_portable_commit_phase_strict'],
  ['archive_semantics_required','public','xrpl_complete_portable_finalize_phase'],
  ['archive_duplicate_fallback_required','xrpl_phase_archive_v1','duplicate_completion'],
  ['current_r5_compat_required','public','xrpl_claim_r5_revision4_recovery_batch'],
  ['current_r5_compat_required','public','xrpl_complete_r5_revision4_recovery_batch_without_qualification'],
  ['current_r5_compat_required','public','xrpl_prepare_r5_revision4_active_recovery'],
  ['current_r5_compat_required','public','xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_s'],
  ['unresolved_blocker','public','xrpl_claim_r5_active_recovery_batch'],
  ['unresolved_blocker','public','xrpl_complete_r5_active_recovery_batch'],
  ['unresolved_blocker','public','xrpl_drain_r5_checkpoint_boundary'],
  ['unresolved_blocker','public','xrpl_ensure_remote_seven_class_epoch'],
]
const targetNames=[...new Set(TARGETS.map(([, ,name])=>name))]
const targetSchemas=[...new Set(TARGETS.map(([,schema])=>schema))]
const quotedNames=targetNames.map((name)=>`'${name.replaceAll("'","''")}'`).join(',')
const quotedSchemas=targetSchemas.map((schema)=>`'${schema.replaceAll("'","''")}'`).join(',')
const targetKey=(schema,name)=>`${schema}.${name}`
const expectedKeys=new Set(TARGETS.map(([,schema,name])=>targetKey(schema,name)))
const SQL=`select jsonb_agg(jsonb_build_object(
  'schemaName',n.nspname,
  'functionName',p.proname,
  'identityArguments',pg_get_function_identity_arguments(p.oid),
  'definition',pg_get_functiondef(p.oid),
  'source',p.prosrc,
  'owner',pg_get_userbyid(p.proowner),
  'serviceRoleExecute',has_function_privilege('service_role',p.oid,'EXECUTE')
) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))::text as state
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname in (${quotedSchemas})
  and p.prokind='f'
  and p.proname in (${quotedNames});`
if (!/^\s*select\b/iu.test(SQL)) fail('target source audit must be SELECT only')

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
  if (!Array.isArray(rows)||rows.length<1) fail('empty target source audit')
  const keys=Object.keys(rows[0]??{})
  if (keys.length!==1) fail('unexpected target source audit shape')
  return rows[0][keys[0]]
}

const options=parseArgs(process.argv.slice(2))
const sourceCommit=options['source-commit']
const outputDir=resolve(options['output-dir']??'r5-index-footprint-readonly-probe')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit')
const raw=oneColumn(await query(SQL))
const rows=typeof raw==='string'?JSON.parse(raw):raw
if (!Array.isArray(rows)) fail('target source rows missing')
const selectedRows=rows.filter((row)=>expectedKeys.has(targetKey(row.schemaName,row.functionName)))
const foundKeys=new Set(selectedRows.map((row)=>targetKey(row.schemaName,row.functionName)))
const missing=TARGETS.filter(([,schema,name])=>!foundKeys.has(targetKey(schema,name)))
  .map(([,schema,name])=>targetKey(schema,name))
if (missing.length) fail(`target production functions missing: ${missing.join(',')}`)
const duplicateTargets=selectedRows.filter((row)=>row.schemaName==='xrpl_phase_archive_v1' && row.functionName==='duplicate_completion')
if (duplicateTargets.length!==1) fail(`archive duplicate_completion overload count must be 1, got ${duplicateTargets.length}`)
const enriched=selectedRows.map((row)=>{
  const reason=TARGETS.find(([,schema,name])=>schema===row.schemaName && name===row.functionName)?.[0]??'unknown'
  return {
    ...row,
    reason,
    definitionSha256:createHash('sha256').update(String(row.definition),'utf8').digest('hex'),
    sourceSha256:createHash('sha256').update(String(row.source),'utf8').digest('hex'),
    definitionBytes:Buffer.byteLength(String(row.definition),'utf8'),
  }
})
const evidence={
  sourceCommit,
  productionDatabaseReadOnly:true,
  noProductionMutationAuthorized:true,
  targetNameCount:TARGETS.length,
  targetDefinitionCount:enriched.length,
  targets:enriched,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/transport-target-source-evidence.json`,serialized)
await writeFile(`${outputDir}/transport-target-source-evidence.sha256`,`${digest}\n`)
const groups={}
for (const row of enriched) (groups[row.reason]??=[]).push(row)
const summary=[
  '## Phase transport target source read-only audit',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- target names / production definitions: \`${TARGETS.length} / ${enriched.length}\``,
  `- archive semantics definitions: \`${groups.archive_semantics_required?.length??0}\``,
  `- archive duplicate fallback definitions: \`${groups.archive_duplicate_fallback_required?.length??0}\``,
  `- current R5 definitions: \`${groups.current_r5_compat_required?.length??0}\``,
  `- unresolved blocker definitions: \`${groups.unresolved_blocker?.length??0}\``,
  `- service-role executable targets: \`${enriched.filter((row)=>row.serviceRoleExecute===true).length}\``,
  '- exact definitions stored in artifact: `true`',
  '- production mutation: `false`',
  '',
  'Archive duplicate fallback exact definition fingerprint:',
  ...(groups.archive_duplicate_fallback_required??[]).map((row)=>`- \`${row.schemaName}.${row.functionName}(${row.identityArguments})\`: ${row.definitionSha256}`),
  '',
  'Current R5 exact definition fingerprints:',
  ...(groups.current_r5_compat_required??[]).map((row)=>`- \`${row.schemaName}.${row.functionName}(${row.identityArguments})\`: ${row.definitionSha256}`),
  '',
  'Unresolved blocker exact definition fingerprints:',
  ...(groups.unresolved_blocker??[]).map((row)=>`- \`${row.schemaName}.${row.functionName}(${row.identityArguments})\`: ${row.definitionSha256}`),
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/transport-target-source-summary.md`,`${summary}\n`)
console.log(summary)
