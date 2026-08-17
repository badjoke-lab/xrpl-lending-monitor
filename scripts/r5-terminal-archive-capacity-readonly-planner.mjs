#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const PROVIDER_DATABASE_LIMIT_BYTES = 500_000_000
const OPERATIONAL_SAFETY_CEILING_BYTES = 490_000_000
const INTERNAL_DB_HALT_BYTES = 400_000_000
const TRANCHE_ROWS = 250
const MIN_ARCHIVE_ROW_UPPER_BOUND_BYTES = 2_500
const ARCHIVE_ROW_SAFETY_MULTIPLIER = 1.5

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
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
with relation_state as (
  select jsonb_object_agg(c.relname, jsonb_build_object(
    'totalBytes', pg_total_relation_size(c.oid),
    'heapBytes', pg_relation_size(c.oid),
    'indexBytes', pg_indexes_size(c.oid),
    'liveTuplesEstimate', coalesce(s.n_live_tup,0),
    'deadTuplesEstimate', coalesce(s.n_dead_tup,0)
  )) as value
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  left join pg_stat_user_tables s on s.relid=c.oid
  where n.nspname='public'
    and c.relname in ('xrpl_phase_messages','xrpl_phase_successors')
  group by n.nspname
), secondary_indexes as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'tableName', t.relname,
    'indexName', i.relname,
    'indexBytes', pg_relation_size(i.oid),
    'constraintBacked', con.oid is not null,
    'definition', pg_get_indexdef(i.oid)
  ) order by pg_relation_size(i.oid) desc, i.relname), '[]'::jsonb) as rows,
  coalesce(sum(pg_relation_size(i.oid)) filter (where con.oid is null),0)::bigint as nonconstraint_bytes
  from pg_class i
  join pg_index ix on ix.indexrelid=i.oid
  join pg_class t on t.oid=ix.indrelid
  join pg_namespace n on n.oid=t.relnamespace
  left join pg_constraint con on con.conindid=i.oid
  where n.nspname='public'
    and t.relname in (
      'xrpl_phase_messages','xrpl_phase_successors','xrpl_phase_work',
      'xrpl_phase_reference_rows','xrpl_collector_runs'
    )
), archive_state as (
  select jsonb_build_object(
    'rows', count(*),
    'totalBytes', pg_total_relation_size('xrpl_phase_archive_v1.terminal_messages'::regclass),
    'heapBytes', pg_relation_size('xrpl_phase_archive_v1.terminal_messages'::regclass),
    'indexBytes', pg_indexes_size('xrpl_phase_archive_v1.terminal_messages'::regclass)
  ) as value
  from xrpl_phase_archive_v1.terminal_messages
), eligible as (
  select count(*)::bigint as rows
  from public.xrpl_phase_messages
  where profile_id='supabase-devnet'
    and status='completed'
    and completed_at is not null
    and completed_at < clock_timestamp()-interval '24 hours'
)
select jsonb_build_object(
  'observedAt', clock_timestamp(),
  'databaseBytes', pg_database_size(current_database()),
  'relations', (select value from relation_state),
  'archive', (select value from archive_state),
  'eligiblePrimaryRows', (select rows from eligible),
  'selectedIndexes', (select rows from secondary_indexes),
  'selectedNonConstraintIndexBytes', (select nonconstraint_bytes from secondary_indexes)
) as state;`

if (!/^\s*with\b/iu.test(SQL)) fail('capacity planner must be one read-only WITH/SELECT statement')
if (/\b(delete\s+from|truncate|vacuum|reindex|alter\s+table|drop\s+(?:table|index)|create\s+(?:table|index)|update\s+|insert\s+into)\b/iu.test(SQL.replace(/'[^']*'/gu, "''"))) {
  fail('capacity planner SQL contains mutation capability')
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
  if (!Array.isArray(rows)||rows.length<1) fail('empty capacity planner response')
  const keys=Object.keys(rows[0]??{})
  if (keys.length!==1) fail('unexpected capacity planner response shape')
  return rows[0][keys[0]]
}

const options=parseArgs(process.argv.slice(2))
const sourceCommit=options['source-commit']
const outputDir=resolve(options['output-dir']??'r5-index-footprint-readonly-probe')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit')
await mkdir(outputDir,{recursive:true})

const raw=oneColumn(await query(SQL))
const state=typeof raw==='string'?JSON.parse(raw):raw
const databaseBytes=Number(state.databaseBytes)
const archiveRows=Number(state.archive?.rows??0)
const archiveTotalBytes=Number(state.archive?.totalBytes??0)
const measuredArchiveBytesPerRow=archiveRows>0?Math.ceil(archiveTotalBytes/archiveRows):0
const conservativeArchiveBytesPerRow=Math.max(
  MIN_ARCHIVE_ROW_UPPER_BOUND_BYTES,
  Math.ceil(measuredArchiveBytesPerRow*ARCHIVE_ROW_SAFETY_MULTIPLIER),
)
const safetyHeadroomBytes=OPERATIONAL_SAFETY_CEILING_BYTES-databaseBytes
const providerHeadroomBytes=PROVIDER_DATABASE_LIMIT_BYTES-databaseBytes
const safeAdditionalArchiveRows=Math.max(0,Math.floor(safetyHeadroomBytes/conservativeArchiveBytesPerRow))
const safeAdditionalTranches=Math.max(0,Math.floor(safeAdditionalArchiveRows/TRANCHE_ROWS))
const messageTotalBytes=Number(state.relations?.xrpl_phase_messages?.totalBytes??0)
const successorTotalBytes=Number(state.relations?.xrpl_phase_successors?.totalBytes??0)
const selectedNonConstraintIndexBytes=Number(state.selectedNonConstraintIndexBytes??0)
const vacuumFullMessageConservativePeakBytes=databaseBytes+messageTotalBytes
const vacuumFullSuccessorConservativePeakBytes=databaseBytes+successorTotalBytes
const hypotheticalAfterSelectedSecondaryDropBytes=databaseBytes-selectedNonConstraintIndexBytes
const hypotheticalVacuumMessagePeakAfterSelectedSecondaryDropBytes=hypotheticalAfterSelectedSecondaryDropBytes+messageTotalBytes
const hypotheticalVacuumSuccessorPeakAfterSelectedSecondaryDropBytes=hypotheticalAfterSelectedSecondaryDropBytes+successorTotalBytes

const evidence={
  schemaVersion:1,
  purpose:'r5-terminal-archive-capacity-readonly-planner',
  sourceCommit,
  observedAt:state.observedAt,
  limits:{
    providerDatabaseLimitBytes:PROVIDER_DATABASE_LIMIT_BYTES,
    operationalSafetyCeilingBytes:OPERATIONAL_SAFETY_CEILING_BYTES,
    internalDatabaseHaltBytes:INTERNAL_DB_HALT_BYTES,
    providerReserveBytes:PROVIDER_DATABASE_LIMIT_BYTES-OPERATIONAL_SAFETY_CEILING_BYTES,
  },
  databaseBytes,
  providerHeadroomBytes,
  safetyHeadroomBytes,
  eligiblePrimaryRows:Number(state.eligiblePrimaryRows??0),
  archive:{
    rows:archiveRows,
    totalBytes:archiveTotalBytes,
    heapBytes:Number(state.archive?.heapBytes??0),
    indexBytes:Number(state.archive?.indexBytes??0),
    measuredBytesPerRow:measuredArchiveBytesPerRow,
    safetyMultiplier:ARCHIVE_ROW_SAFETY_MULTIPLIER,
    conservativeBytesPerAdditionalRow:conservativeArchiveBytesPerRow,
  },
  tranche:{
    rows:TRANCHE_ROWS,
    conservativeBytesPerTranche:conservativeArchiveBytesPerRow*TRANCHE_ROWS,
    safeAdditionalArchiveRows,
    safeAdditionalTranches,
    oneMoreTrancheFitsSafetyCeiling:safeAdditionalTranches>=1,
  },
  relations:state.relations,
  selectedIndexes:state.selectedIndexes,
  selectedNonConstraintIndexBytes,
  physicalRewriteCapacity:{
    vacuumFullMessageConservativePeakBytes,
    vacuumFullSuccessorConservativePeakBytes,
    vacuumFullMessageSafeNow:vacuumFullMessageConservativePeakBytes<=OPERATIONAL_SAFETY_CEILING_BYTES,
    vacuumFullSuccessorSafeNow:vacuumFullSuccessorConservativePeakBytes<=OPERATIONAL_SAFETY_CEILING_BYTES,
    hypotheticalAfterSelectedSecondaryDropBytes,
    hypotheticalVacuumMessagePeakAfterSelectedSecondaryDropBytes,
    hypotheticalVacuumSuccessorPeakAfterSelectedSecondaryDropBytes,
    hypotheticalVacuumMessageSafeAfterSelectedSecondaryDrop:hypotheticalVacuumMessagePeakAfterSelectedSecondaryDropBytes<=OPERATIONAL_SAFETY_CEILING_BYTES,
    hypotheticalVacuumSuccessorSafeAfterSelectedSecondaryDrop:hypotheticalVacuumSuccessorPeakAfterSelectedSecondaryDropBytes<=OPERATIONAL_SAFETY_CEILING_BYTES,
  },
  decision:{
    additionalTrancheExecutionAuthorized:false,
    secondaryIndexMutationAuthorized:false,
    physicalCompactionAuthorized:false,
    r5RearmAuthorized:false,
    reason:safeAdditionalTranches<1
      ? 'stop_before_provider_ceiling_and_design_separate_reclaim'
      : 'capacity_exists_only_for_separately_authorized_bounded_tranches; physical_rewrite_remains_separate',
  },
  productionDatabaseReadOnly:true,
}

if (databaseBytes>=PROVIDER_DATABASE_LIMIT_BYTES) fail('database is already at/above fixed provider Free read-only threshold')
if (OPERATIONAL_SAFETY_CEILING_BYTES>=PROVIDER_DATABASE_LIMIT_BYTES) fail('operational safety ceiling must remain below provider limit')
if (evidence.decision.additionalTrancheExecutionAuthorized!==false || evidence.decision.physicalCompactionAuthorized!==false || evidence.decision.r5RearmAuthorized!==false) fail('capacity planner must never authorize mutation')

const serialized=`${JSON.stringify(evidence,null,2)}\n`
const digest=sha256(serialized)
await writeFile(`${outputDir}/terminal-archive-capacity-planner.json`,serialized)
await writeFile(`${outputDir}/terminal-archive-capacity-planner.sha256`,`${digest}\n`)
const summary=[
  '## Terminal archive capacity read-only planner',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- database bytes: \`${databaseBytes}\``,
  `- provider Free read-only threshold: \`${PROVIDER_DATABASE_LIMIT_BYTES}\``,
  `- operational safety ceiling / reserve: \`${OPERATIONAL_SAFETY_CEILING_BYTES} / ${PROVIDER_DATABASE_LIMIT_BYTES-OPERATIONAL_SAFETY_CEILING_BYTES}\``,
  `- provider / safety headroom: \`${providerHeadroomBytes} / ${safetyHeadroomBytes}\``,
  `- archive rows / total bytes: \`${archiveRows} / ${archiveTotalBytes}\``,
  `- measured / conservative archive bytes per row: \`${measuredArchiveBytesPerRow} / ${conservativeArchiveBytesPerRow}\``,
  `- conservative bytes per 250-row tranche: \`${conservativeArchiveBytesPerRow*TRANCHE_ROWS}\``,
  `- safe additional archive rows / 250-row tranches before re-plan: \`${safeAdditionalArchiveRows} / ${safeAdditionalTranches}\``,
  `- message VACUUM FULL conservative peak / safe now: \`${vacuumFullMessageConservativePeakBytes} / ${vacuumFullMessageConservativePeakBytes<=OPERATIONAL_SAFETY_CEILING_BYTES}\``,
  `- successor VACUUM FULL conservative peak / safe now: \`${vacuumFullSuccessorConservativePeakBytes} / ${vacuumFullSuccessorConservativePeakBytes<=OPERATIONAL_SAFETY_CEILING_BYTES}\``,
  `- selected non-constraint index bytes (hypothetical relief only): \`${selectedNonConstraintIndexBytes}\``,
  `- mutation authorized: \`false\``,
  `- physical compaction / R5 rearm authorized: \`false / false\``,
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/terminal-archive-capacity-planner-summary.md`,`${summary}\n`)
console.log(summary)
