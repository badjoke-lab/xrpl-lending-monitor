#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SIGNATURE = 'public.xrpl_read_throughput_resource_baseline(timestamp with time zone,integer)'
const EXPECTED_DEFINITION_SHA = '8810b1249cbda215e25756ad68df2a3c93a99a0934e860a8333b6885df5bd139'
const EXPECTED_SOURCE_SHA = '338c5318b8a93768f86f9492e7c3a665a542010e3017bd738b8590e834ec61e1'

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function env(name, pattern = null) { const value=process.env[name]; if(!value) fail(`missing ${name}`); if(pattern&&!pattern.test(value)) fail(`invalid ${name}`); return value }
function args(argv) { const out={}; for(let i=0;i<argv.length;i+=2){ if(!argv[i]?.startsWith('--')||argv[i+1]==null) fail('invalid arguments'); out[argv[i].slice(2)]=argv[i+1] } return out }

async function query() {
  const projectId=env('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u)
  const token=env('SUPABASE_ACCESS_TOKEN')
  const sql=`select jsonb_build_object(
    'definition', pg_get_functiondef('${SIGNATURE}'::regprocedure),
    'sourceSha256', encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),
    'serviceRoleExecute', has_function_privilege('service_role',p.oid,'EXECUTE')
  ) as state
  from pg_proc p
  where p.oid='${SIGNATURE}'::regprocedure;`
  const response=await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:true}),
    signal:AbortSignal.timeout(60000),
  })
  const text=await response.text()
  if(!response.ok) fail(`Management API query failed: ${response.status} ${text.slice(0,500)}`)
  const rows=JSON.parse(text)
  const raw=rows?.[0]?.state
  if(raw==null) fail('throughput gate returned no state')
  return typeof raw==='string'?JSON.parse(raw):raw
}

const options=args(process.argv.slice(2))
const sourceCommit=options['source-commit']
if(!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit')
const outputDir=resolve(options['output-dir']??'r5-terminal-archive-phase-b-throughput-gate')
await mkdir(outputDir,{recursive:true})

const state=await query()
const definition=String(state.definition??'')
const definitionSha=sha256(definition)
if(definitionSha!==EXPECTED_DEFINITION_SHA) fail(`throughput definition drifted: ${definitionSha}`)
if(state.sourceSha256!==EXPECTED_SOURCE_SHA) fail(`throughput source drifted: ${state.sourceSha256}`)
for(const marker of [
  "v_profile_id constant text := 'supabase-devnet'",
  'p_window_minutes not in (60, 360, 1440)',
  'v_window_start := p_observed_at - make_interval(mins => p_window_minutes)',
  'from public.xrpl_phase_messages',
  'and created_at >= v_window_start',
  'and created_at < p_observed_at',
]) {
  if(!definition.includes(marker)) fail(`throughput 24h compatibility marker missing: ${marker}`)
}

const evidence={
  schemaVersion:1,
  purpose:'r5-terminal-archive-phase-b-throughput-readonly-gate',
  sourceCommit,
  definitionSha256:definitionSha,
  sourceSha256:state.sourceSha256,
  serviceRoleExecute:state.serviceRoleExecute===true,
  profileId:'supabase-devnet',
  maximumWindowMinutes:1440,
  phaseMessageWindowColumn:'created_at',
  phaseBEligibilityColumn:'completed_at',
  compatibilityReason:'completed_at before a 24h cutoff implies created_at is also before that cutoff, so Phase B rows are outside every permitted throughput window',
  productionDatabaseReadOnly:true,
  terminalTransportMutationAuthorized:false,
  physicalCompactionAuthorized:false,
  r5RearmAuthorized:false,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=sha256(serialized)
await writeFile(`${outputDir}/terminal-archive-phase-b-throughput-gate.json`,serialized)
await writeFile(`${outputDir}/terminal-archive-phase-b-throughput-gate.sha256`,`${digest}\n`)
await writeFile(`${outputDir}/terminal-archive-phase-b-throughput-gate-summary.md`,[
  '## Terminal archive Phase B throughput read-only gate','',
  `- source commit: \`${sourceCommit}\``,
  `- production definition/source SHA-256: \`${definitionSha} / ${state.sourceSha256}\``,
  '- permitted windows: `60 / 360 / 1440 minutes`',
  '- primary profile: `supabase-devnet`',
  '- message attempt window: `created_at >= windowStart && created_at < observedAt`',
  '- Phase B cutoff: `completed_at < observedAt - 24h`',
  '- compatibility: `PASS`',
  '- production mutation: `false`',
  '- physical compaction / R5 rearm authorized: `false / false`','',
  `Evidence SHA-256: \`${digest}\``,'',
].join('\n'))
console.log(JSON.stringify(evidence))
