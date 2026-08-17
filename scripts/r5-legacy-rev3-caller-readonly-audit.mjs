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
const seedList = TARGETS.map((name)=>`'${name.replaceAll("'","''")}'`).join(',')
const SQL=`with recursive closure as (
  select p.oid,n.nspname as schema_name,p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosrc,0 as depth,null::text collate "C" as depends_on,array[p.oid]::oid[] as path
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','xrpl_r5_v1') and p.prokind='f' and p.proname in (${seedList})
  union all
  select caller.oid,cn.nspname,caller.proname,
    pg_get_function_identity_arguments(caller.oid),caller.prosrc,parent.depth+1,parent.function_name,parent.path||caller.oid
  from closure parent
  join pg_proc caller on caller.prosrc ilike ('%'||parent.function_name||'(%')
  join pg_namespace cn on cn.oid=caller.pronamespace
  where cn.nspname in ('public','xrpl_r5_v1') and caller.prokind='f'
    and has_function_privilege('service_role',caller.oid,'EXECUTE')
    and not caller.oid=any(parent.path)
    and parent.depth < 12
), rows as (
  select c.*,encode(extensions.digest(convert_to(c.prosrc,'UTF8'),'sha256'),'hex') as source_sha256,
    encode(extensions.digest(convert_to(pg_get_functiondef(c.oid),'UTF8'),'sha256'),'hex') as definition_sha256,
    has_function_privilege('service_role',c.oid,'EXECUTE') as service_role_execute,
    has_function_privilege('authenticated',c.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('anon',c.oid,'EXECUTE') as anon_execute
  from closure c
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'rows',coalesce(jsonb_agg(jsonb_build_object(
    'oid',oid::text,'schemaName',schema_name,'functionName',function_name,'identityArguments',identity_arguments,
    'depth',depth,'dependsOn',depends_on,'sourceSha256',source_sha256,'definitionSha256',definition_sha256,
    'serviceRoleExecute',service_role_execute,'authenticatedExecute',authenticated_execute,'anonExecute',anon_execute,'source',prosrc
  ) order by depth,schema_name,function_name,identity_arguments,depends_on) filter (where oid is not null),'[]'::jsonb)
)::text as state from rows;`
if(!/^\s*with\s+recursive\b/iu.test(SQL))fail('audit must be a recursive read-only query')
async function query(){const projectId=env('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u),token=env('SUPABASE_ACCESS_TOKEN');const response=await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:SQL,read_only:true}),signal:AbortSignal.timeout(60000)});const text=await response.text();if(!response.ok)fail(`query failed ${response.status}: ${text.slice(0,500)}`);const rows=JSON.parse(text);const raw=rows?.[0]?.state;return typeof raw==='string'?JSON.parse(raw):raw}
const options=args(process.argv.slice(2)),sourceCommit=options['source-commit'];if(!/^[a-f0-9]{40}$/u.test(sourceCommit??''))fail('invalid --source-commit');const outputDir=resolve(options['output-dir']??'r5-index-footprint-readonly-probe');await mkdir(outputDir,{recursive:true});const state=await query();const grouped=new Map();for(const row of state.rows??[]){const key=`${row.oid}:${row.functionName}:${row.identityArguments}`;const current=grouped.get(key)??{...row,depths:[],dependsOn:[]};current.depths.push(Number(row.depth));if(row.dependsOn&&!current.dependsOn.includes(row.dependsOn))current.dependsOn.push(row.dependsOn);current.depth=Math.min(...current.depths);grouped.set(key,current)}const closure=[...grouped.values()].sort((a,b)=>a.depth-b.depth||a.functionName.localeCompare(b.functionName)||a.identityArguments.localeCompare(b.identityArguments));const executableCallers=closure.filter((row)=>row.depth>0&&row.serviceRoleExecute===true);const leafCallers=executableCallers.filter((row)=>!closure.some((candidate)=>candidate.depth>row.depth&&candidate.dependsOn.includes(row.functionName)));const evidence={schemaVersion:2,purpose:'r5-legacy-rev3-caller-readonly-audit',sourceCommit,databaseBytes:Number(state.databaseBytes),seedTargets:TARGETS,closureFunctionCount:closure.length,serviceRoleExecutableCallerCount:executableCallers.length,leafExecutableCallerCount:leafCallers.length,closure,leafExecutableCallers:leafCallers,safety:{productionDatabaseReadOnly:true,permissionMutationAuthorized:false,transportRowMutationAuthorized:false,physicalCompactionAuthorized:false,r5RearmAuthorized:false}};const serialized=`${JSON.stringify(evidence,null,2)}\n`,digest=sha(serialized);await writeFile(`${outputDir}/legacy-rev3-caller-evidence.json`,serialized);await writeFile(`${outputDir}/legacy-rev3-caller-evidence.sha256`,`${digest}\n`);const summary=['## Legacy revision-3 recursive caller read-only audit','',`- source commit: \`${sourceCommit}\``,`- closure functions: \`${closure.length}\``,`- service-role executable callers in closure: \`${executableCallers.length}\``,`- outermost executable callers: \`${leafCallers.length}\``,'- production permission mutation: `false`','- transport row mutation: `false`','- physical compaction: `false`','- R5 rearm: `false`','',...closure.map((row)=>`- depth ${row.depth}: \`${row.schemaName}.${row.functionName}(${row.identityArguments})\` source=\`${row.sourceSha256}\`; dependsOn=${row.dependsOn.length?row.dependsOn.map((name)=>`\`${name}\``).join(', '):'seed'}`),'',`Evidence SHA-256: \`${digest}\``].join('\n');await writeFile(`${outputDir}/legacy-rev3-caller-summary.md`,`${summary}\n`);console.log(summary)
