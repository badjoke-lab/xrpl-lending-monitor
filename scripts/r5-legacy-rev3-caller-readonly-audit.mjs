import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const TARGETS = [
  'xrpl_create_r5_active_checkpoint_strict',
  'xrpl_prepare_r5_active_recovery',
  'xrpl_claim_r5_active_recovery_batch',
  'xrpl_complete_r5_active_recovery_batch',
]
function fail(message){throw new Error(message)}
function env(name,pattern=null){const value=process.env[name];if(!value)fail(`missing ${name}`);if(pattern&&!pattern.test(value))fail(`invalid ${name}`);return value}
function args(argv){const out={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]==null)fail('invalid arguments');out[argv[i].slice(2)]=argv[i+1]}return out}
function sha(value){return createHash('sha256').update(String(value),'utf8').digest('hex')}
const targetPredicate = TARGETS.map((name)=>`p.prosrc ilike '%${name.replaceAll("'","''")}(%'`).join(' or ')
const SQL=`select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'callers',coalesce(jsonb_agg(jsonb_build_object(
    'schemaName',n.nspname,
    'functionName',p.proname,
    'identityArguments',pg_get_function_identity_arguments(p.oid),
    'sourceSha256',encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),
    'definitionSha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
    'serviceRoleExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'source',p.prosrc
  ) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) filter (where p.oid is not null),'[]'::jsonb)
)::text as state
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','xrpl_r5_v1') and p.prokind='f' and (${targetPredicate});`
if(!/^\s*select\b/iu.test(SQL))fail('audit must be SELECT only')
async function query(){const projectId=env('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u),token=env('SUPABASE_ACCESS_TOKEN');const response=await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:SQL,read_only:true}),signal:AbortSignal.timeout(60000)});const text=await response.text();if(!response.ok)fail(`query failed ${response.status}: ${text.slice(0,500)}`);const rows=JSON.parse(text);const raw=rows?.[0]?.state;return typeof raw==='string'?JSON.parse(raw):raw}
const options=args(process.argv.slice(2)),sourceCommit=options['source-commit'];if(!/^[a-f0-9]{40}$/u.test(sourceCommit??''))fail('invalid --source-commit');const outputDir=resolve(options['output-dir']??'r5-index-footprint-readonly-probe');await mkdir(outputDir,{recursive:true});const state=await query();const callers=(state.callers??[]).map((caller)=>({...caller,targets:TARGETS.filter((name)=>String(caller.source).toLowerCase().includes(`${name}(`))}));const executable=callers.filter((caller)=>caller.serviceRoleExecute===true);const evidence={schemaVersion:1,purpose:'r5-legacy-rev3-caller-readonly-audit',sourceCommit,databaseBytes:Number(state.databaseBytes),callerCount:callers.length,serviceRoleExecutableCallerCount:executable.length,callers,safety:{productionDatabaseReadOnly:true,permissionMutationAuthorized:false,transportRowMutationAuthorized:false,physicalCompactionAuthorized:false,r5RearmAuthorized:false}};const serialized=`${JSON.stringify(evidence,null,2)}\n`,digest=sha(serialized);await writeFile(`${outputDir}/legacy-rev3-caller-evidence.json`,serialized);await writeFile(`${outputDir}/legacy-rev3-caller-evidence.sha256`,`${digest}\n`);const summary=['## Legacy revision-3 caller read-only audit','',`- source commit: \`${sourceCommit}\``,`- matching callers: \`${callers.length}\``,`- service-role executable callers: \`${executable.length}\``,'- production permission mutation: `false`','- transport row mutation: `false`','- physical compaction: `false`','- R5 rearm: `false`','',...executable.map((caller)=>`- \`${caller.schemaName}.${caller.functionName}(${caller.identityArguments})\` source=\`${caller.sourceSha256}\`; targets=${caller.targets.map((target)=>`\`${target}\``).join(', ')}`),'',`Evidence SHA-256: \`${digest}\``].join('\n');await writeFile(`${outputDir}/legacy-rev3-caller-summary.md`,`${summary}\n`);console.log(summary)
