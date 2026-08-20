import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) { throw new Error(message) }
function need(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parse(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) fail('invalid arguments')
    out[argv[i].slice(2)] = argv[i + 1]
  }
  return out
}

const SQL = String.raw`with routines as (
  select
    n.nspname as schema_name,
    p.proname as routine_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.prokind in ('f','p')
    and n.nspname not in ('pg_catalog','information_schema')
), archive_routines as (
  select
    schema_name,
    routine_name,
    identity_arguments,
    definition,
    definition ilike '%xrpl_phase_archive_v1.terminal_messages%' as terminal_table_ref,
    definition ilike '%xrpl_phase_archive_v1.terminalize_message%' as terminalize_message_ref,
    definition ilike '%xrpl_phase_archive_v1.terminalize_completed_window%' as terminalize_window_ref,
    definition ilike '%xrpl_phase_archive_v1.assert_message_identity%' as assert_message_identity_ref,
    definition ilike '%xrpl_phase_archive_v1.assert_successor_identity%' as assert_successor_identity_ref,
    definition ilike '%xrpl_phase_archive_v1.duplicate_completion%' as duplicate_completion_ref,
    definition ilike '%result_digest%' as result_digest_ref,
    definition ilike '%completed_at%' as completed_at_ref,
    definition ilike '%successor_message_id%' as successor_message_id_ref,
    definition ilike '%payload%' as payload_ref
  from routines
  where definition ilike '%xrpl_phase_archive_v1%'
     or schema_name='xrpl_phase_archive_v1'
), view_consumers as (
  select schemaname as schema_name, viewname as view_name, definition
  from pg_views
  where schemaname not in ('pg_catalog','information_schema')
    and definition ilike '%xrpl_phase_archive_v1%'
), policy_consumers as (
  select schemaname as schema_name, tablename as table_name, policyname as policy_name,
         coalesce(qual,'') || E'\n' || coalesce(with_check,'') as definition
  from pg_policies
  where coalesce(qual,'') ilike '%xrpl_phase_archive_v1%'
     or coalesce(with_check,'') ilike '%xrpl_phase_archive_v1%'
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'routineCount',(select count(*) from archive_routines),
  'outsideArchiveSchemaRoutineCount',(select count(*) from archive_routines where schema_name <> 'xrpl_phase_archive_v1'),
  'resultDigestRoutineCount',(select count(*) from archive_routines where result_digest_ref),
  'outsideArchiveSchemaResultDigestRoutineCount',(select count(*) from archive_routines where schema_name <> 'xrpl_phase_archive_v1' and result_digest_ref),
  'completedAtRoutineCount',(select count(*) from archive_routines where completed_at_ref),
  'outsideArchiveSchemaCompletedAtRoutineCount',(select count(*) from archive_routines where schema_name <> 'xrpl_phase_archive_v1' and completed_at_ref),
  'duplicateCompletionCallerCount',(select count(*) from archive_routines where duplicate_completion_ref and not (schema_name='xrpl_phase_archive_v1' and routine_name='duplicate_completion')),
  'viewConsumerCount',(select count(*) from view_consumers),
  'policyConsumerCount',(select count(*) from policy_consumers),
  'routines',coalesce((select jsonb_agg(jsonb_build_object(
    'schema',schema_name,
    'name',routine_name,
    'identityArguments',identity_arguments,
    'terminalTableRef',terminal_table_ref,
    'terminalizeMessageRef',terminalize_message_ref,
    'terminalizeWindowRef',terminalize_window_ref,
    'assertMessageIdentityRef',assert_message_identity_ref,
    'assertSuccessorIdentityRef',assert_successor_identity_ref,
    'duplicateCompletionRef',duplicate_completion_ref,
    'resultDigestRef',result_digest_ref,
    'completedAtRef',completed_at_ref,
    'successorMessageIdRef',successor_message_id_ref,
    'payloadRef',payload_ref
  ) order by schema_name,routine_name,identity_arguments) from archive_routines),'[]'::jsonb),
  'views',coalesce((select jsonb_agg(jsonb_build_object('schema',schema_name,'name',view_name) order by schema_name,view_name) from view_consumers),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(jsonb_build_object('schema',schema_name,'table',table_name,'name',policy_name) order by schema_name,table_name,policy_name) from policy_consumers),'[]'::jsonb)
)::text as state;`

if (!/^\s*with\b/iu.test(SQL) || /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu.test(SQL)) {
  fail('archive consumer audit must be SELECT/read_only only')
}

async function query() {
  const project = need('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = need('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:SQL,read_only:true}),
    signal:AbortSignal.timeout(60000),
  })
  const text=await response.text()
  if (!response.ok) fail(`query failed ${response.status}: ${text.slice(0,500)}`)
  const rows=JSON.parse(text)
  const raw=rows?.[0]?.state
  return typeof raw==='string'?JSON.parse(raw):raw
}

const options=parse(process.argv.slice(2))
const sourceCommit=options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit')
const outputDir=resolve(options['output-dir']??'r5-terminal-archive-consumer-readonly')
await mkdir(outputDir,{recursive:true})
const state=await query()
const evidence={
  schemaVersion:1,
  purpose:'r5-terminal-archive-consumer-readonly-audit',
  sourceCommit,
  ...state,
  interpretation:'Enumerates production function/procedure, view, and policy source that directly references the terminal archive schema or helpers. Field-reference counts distinguish archive-internal storage/idempotency requirements from outside-schema runtime consumers. Source inspection is diagnostic and does not by itself authorize a compatibility redesign.',
  archiveMutationAuthorized:false,
  phaseBMutationAuthorized:false,
  r5RearmAuthorized:false,
  productionDatabaseReadOnly:true,
}
const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=createHash('sha256').update(serialized).digest('hex')
await writeFile(`${outputDir}/consumer-audit.json`,serialized)
await writeFile(`${outputDir}/consumer-audit.sha256`,`${digest}\n`)
const routineLines=(state.routines??[]).map((r)=>`- \`${r.schema}.${r.name}(${r.identityArguments})\`: table=${r.terminalTableRef}, terminalize=${r.terminalizeMessageRef||r.terminalizeWindowRef}, identity=${r.assertMessageIdentityRef||r.assertSuccessorIdentityRef}, duplicate=${r.duplicateCompletionRef}, resultDigest=${r.resultDigestRef}, completedAt=${r.completedAtRef}`)
const summary=[
  '## Terminal archive production consumer read-only audit','',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${state.databaseBytes}\``,
  `- archive-referencing routines: \`${state.routineCount}\``,
  `- outside archive schema routines: \`${state.outsideArchiveSchemaRoutineCount}\``,
  `- result_digest refs total / outside archive schema: \`${state.resultDigestRoutineCount} / ${state.outsideArchiveSchemaResultDigestRoutineCount}\``,
  `- completed_at refs total / outside archive schema: \`${state.completedAtRoutineCount} / ${state.outsideArchiveSchemaCompletedAtRoutineCount}\``,
  `- duplicate_completion callers: \`${state.duplicateCompletionCallerCount}\``,
  `- view / policy consumers: \`${state.viewConsumerCount} / ${state.policyConsumerCount}\``,
  '',...routineLines,'',
  'SELECT/read_only only. No archive mutation/deletion, Phase B, R5 rearm, scheduler/deployment/public-reader change, or Mainnet action is authorized.',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/consumer-audit-summary.md`,`${summary}\n`)
console.log(summary)
