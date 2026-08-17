import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message){throw new Error(message)}
function requireEnv(name,pattern=null){const v=process.env[name];if(!v)fail(`missing ${name}`);if(pattern&&!pattern.test(v))fail(`invalid ${name}`);return v}
function parseArgs(argv){const o={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]==null)fail('invalid arguments');o[argv[i].slice(2)]=argv[i+1]}return o}

const SQL=String.raw`
select jsonb_build_object(
  'databaseBytes', pg_database_size(current_database()),
  'functions', coalesce(jsonb_agg(jsonb_build_object(
    'schemaName', n.nspname,
    'functionName', p.proname,
    'identityArguments', pg_get_function_identity_arguments(p.oid),
    'definition', pg_get_functiondef(p.oid),
    'sourceSha256', encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),
    'definitionSha256', encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
    'serviceRoleExecute', has_function_privilege('service_role',p.oid,'EXECUTE')
  ) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb),
  'safety', jsonb_build_object('readOnly',true,'rowMutationAuthorized',false,'permissionMutationAuthorized',false,'physicalCompactionAuthorized',false,'r5RearmAuthorized',false)
)::text as state
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','xrpl_r5_v1')
  and p.prokind='f'
  and (p.prosrc ilike '%xrpl_phase_messages%' or p.prosrc ilike '%xrpl_phase_successors%')
  and (
    p.proname ~ '^(xrpl_build_|xrpl_restore_|xrpl_read_|xrpl_create_r5_active_checkpoint|xrpl_prepare_r5_active_recovery|xrpl_rebind_r5_prebatch_)'
    or p.proname ~ '(remote_fault|restored_continuation|multichunk_witness)'
  );`
if(!/^\s*select\b/iu.test(SQL))fail('audit must be SELECT only')
if(/\b(delete\s+from|truncate|vacuum|alter\s+|drop\s+|create\s+|grant\s+|revoke\s+)\b/iu.test(SQL.replace(/'[^']*'/gu,"''")))fail('mutation capability in audit SQL')

async function query(){const projectId=requireEnv('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u),token=requireEnv('SUPABASE_ACCESS_TOKEN');const r=await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:SQL,read_only:true}),signal:AbortSignal.timeout(60000)});const text=await r.text();if(!r.ok)fail(`query failed ${r.status}: ${text.slice(0,500)}`);const rows=JSON.parse(text);const raw=rows?.[0]?.state;return typeof raw==='string'?JSON.parse(raw):raw}
function calledFunctions(definition){return [...new Set((definition.match(/\bxrpl_[a-z0-9_]+\s*\(/giu)??[]).map(x=>x.replace(/\s*\($/u,'').toLowerCase()))].sort()}
function bodySignals(definition){const d=definition.toLowerCase();return {readsMessages:d.includes('xrpl_phase_messages'),readsSuccessors:d.includes('xrpl_phase_successors'),directMessageInsert:d.includes('insert into public.xrpl_phase_messages'),directMessageUpdate:d.includes('update public.xrpl_phase_messages'),directMessageDelete:d.includes('delete from public.xrpl_phase_messages'),directSuccessorInsert:d.includes('insert into public.xrpl_phase_successors'),directSuccessorDelete:d.includes('delete from public.xrpl_phase_successors'),readsResult:/\bresult\b/u.test(d),readsPayload:/\bpayload\b/u.test(d),usesJsonAggregation:d.includes('jsonb_agg')||d.includes('json_agg'),usesDigest:d.includes('digest(')}}

const options=parseArgs(process.argv.slice(2)),sourceCommit=options['source-commit'],outputDir=resolve(options['output-dir']??'r5-index-footprint-readonly-probe');if(!/^[a-f0-9]{40}$/u.test(sourceCommit??''))fail('invalid --source-commit');await mkdir(outputDir,{recursive:true});const state=await query();if(state.safety?.readOnly!==true)fail('read-only safety missing');
const functions=(state.functions??[]).map(f=>({...f,calledXrplFunctions:calledFunctions(f.definition),signals:bodySignals(f.definition)}));
const executable=functions.filter(f=>f.serviceRoleExecute===true);const evidence={schemaVersion:1,purpose:'historical-transport-consumer-source-readonly-audit',sourceCommit,databaseBytes:Number(state.databaseBytes),functionCount:functions.length,serviceRoleExecutableCount:executable.length,functions,safety:state.safety};const serialized=`${JSON.stringify(evidence,null,2)}\n`,digest=createHash('sha256').update(serialized).digest('hex');await writeFile(`${outputDir}/historical-transport-consumer-source-evidence.json`,serialized);await writeFile(`${outputDir}/historical-transport-consumer-source-evidence.sha256`,`${digest}\n`);
const summary=['## Historical transport consumer source read-only audit','',`- source commit: \`${sourceCommit}\``,`- matching transport consumers: \`${functions.length}\``,`- service-role executable: \`${executable.length}\``,'- production permission mutation: `false`','- transport row mutation: `false`','- physical compaction: `false`','- R5 rearm: `false`','','Service-role executable consumers:',...executable.map(f=>`- \`${f.functionName}(${f.identityArguments})\` source=\`${f.sourceSha256}\`; calls=${f.calledXrplFunctions.length?f.calledXrplFunctions.map(x=>`\`${x}\``).join(', '):'none'}`),'',`Evidence SHA-256: \`${digest}\``].join('\n');await writeFile(`${outputDir}/historical-transport-consumer-source-summary.md`,`${summary}\n`);console.log(summary)
