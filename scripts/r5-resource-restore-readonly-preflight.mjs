#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const RELATION = 'public.xrpl_resource_restore_v1'

function fail(message) {
  throw new Error(message)
}

function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) fail(`unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = argv[index + 1]
    if (value == null || value.startsWith('--')) fail(`missing value for --${key}`)
    options[key] = value
    index += 1
  }
  return options
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  fail('Management API response contains no rows')
}

async function managementQuery(query) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 2000) }
  }
  if (!response.ok) {
    fail(`Supabase Management API read-only query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  }
  return rowsFromResponse(body)
}

async function writeText(path, text) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, text)
}

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}

function firstObject(rows) {
  const value = rows?.[0]
  if (!value || typeof value !== 'object') fail('read-only query returned no object row')
  return value
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
if (!options.output) fail('--output is required')
if (!options.summary) fail('--summary is required')

const catalogRows = await managementQuery(String.raw`
select jsonb_build_object(
  'present', to_regclass('${RELATION}') is not null,
  'relation', '${RELATION}',
  'capturedAt', now(),
  'catalog', case
    when to_regclass('${RELATION}') is null then null
    else (
      select jsonb_build_object(
        'oid', c.oid::bigint,
        'schema', n.nspname,
        'name', c.relname,
        'kind', c.relkind,
        'persistence', c.relpersistence,
        'owner', pg_get_userbyid(c.relowner),
        'rowSecurity', c.relrowsecurity,
        'forceRowSecurity', c.relforcerowsecurity,
        'estimatedRows', c.reltuples::bigint,
        'totalRelationBytes', pg_total_relation_size(c.oid)::bigint,
        'heapBytes', pg_relation_size(c.oid)::bigint,
        'indexBytes', pg_indexes_size(c.oid)::bigint,
        'toastOid', nullif(c.reltoastrelid, 0)::bigint,
        'toastBytes', case when c.reltoastrelid = 0 then 0::bigint else pg_total_relation_size(c.reltoastrelid)::bigint end,
        'acl', coalesce(c.relacl::text, '')
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.oid = to_regclass('${RELATION}')
    )
  end
) as state;
`.trim())

const catalogEnvelope = firstObject(catalogRows).state
if (!catalogEnvelope || typeof catalogEnvelope !== 'object') fail('catalog envelope missing')

let detail = null
if (catalogEnvelope.present === true) {
  const detailRows = await managementQuery(String.raw`
select jsonb_build_object(
  'exactRowCount', (select count(*)::bigint from ${RELATION}),
  'logicalRowBytes', (select coalesce(sum(pg_column_size(r)), 0)::bigint from ${RELATION} r),
  'columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'ordinal', a.attnum,
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull,
      'identity', a.attidentity,
      'generated', a.attgenerated,
      'default', pg_get_expr(d.adbin, d.adrelid)
    ) order by a.attnum), '[]'::jsonb)
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = '${RELATION}'::regclass
      and a.attnum > 0
      and not a.attisdropped
  ),
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', conname,
      'type', contype,
      'definedOn', conrelid::regclass::text,
      'references', case when confrelid = 0 then null else confrelid::regclass::text end,
      'definition', pg_get_constraintdef(oid, true)
    ) order by conname), '[]'::jsonb)
    from pg_constraint
    where conrelid = '${RELATION}'::regclass
       or confrelid = '${RELATION}'::regclass
  ),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', index_class.relname,
      'bytes', pg_relation_size(index_class.oid)::bigint,
      'primary', index_state.indisprimary,
      'unique', index_state.indisunique,
      'valid', index_state.indisvalid,
      'definition', pg_get_indexdef(index_class.oid)
    ) order by pg_relation_size(index_class.oid) desc, index_class.relname), '[]'::jsonb)
    from pg_index index_state
    join pg_class index_class on index_class.oid = index_state.indexrelid
    where index_state.indrelid = '${RELATION}'::regclass
  ),
  'userTriggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', tgname,
      'enabled', tgenabled,
      'definition', pg_get_triggerdef(oid, true)
    ) order by tgname), '[]'::jsonb)
    from pg_trigger
    where tgrelid = '${RELATION}'::regclass
      and not tgisinternal
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', polname,
      'permissive', polpermissive,
      'roles', polroles,
      'command', polcmd,
      'qual', pg_get_expr(polqual, polrelid),
      'withCheck', pg_get_expr(polwithcheck, polrelid)
    ) order by polname), '[]'::jsonb)
    from pg_policy
    where polrelid = '${RELATION}'::regclass
  ),
  'routineMentions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'identityArguments', pg_get_function_identity_arguments(p.oid),
      'securityDefiner', p.prosecdef
    ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and position('xrpl_resource_restore_v1' in lower(pg_get_functiondef(p.oid))) > 0
  ),
  'viewMentions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'name', viewname
    ) order by schemaname, viewname), '[]'::jsonb)
    from pg_views
    where schemaname not in ('pg_catalog', 'information_schema')
      and position('xrpl_resource_restore_v1' in lower(definition)) > 0
  ),
  'stats', (
    select coalesce(jsonb_build_object(
      'estimatedLiveRows', n_live_tup,
      'estimatedDeadRows', n_dead_tup,
      'lastVacuum', last_vacuum,
      'lastAutovacuum', last_autovacuum,
      'vacuumCount', vacuum_count,
      'autovacuumCount', autovacuum_count,
      'lastAnalyze', last_analyze,
      'lastAutoanalyze', last_autoanalyze
    ), '{}'::jsonb)
    from pg_stat_user_tables
    where relid = '${RELATION}'::regclass
  )
) as detail;
`.trim())
  detail = firstObject(detailRows).detail
}

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-resource-restore-readonly-reclaim-preflight',
  sourceCommit,
  relation: RELATION,
  relationPresent: catalogEnvelope.present === true,
  capturedAt: catalogEnvelope.capturedAt ?? null,
  catalog: catalogEnvelope.catalog ?? null,
  detail,
  assessment: {
    exactRowCountKnown: typeof detail?.exactRowCount === 'number',
    physicalFootprintKnown: typeof catalogEnvelope.catalog?.totalRelationBytes === 'number',
    schemaAndDependenciesInspected: detail != null,
    rowContentsPublished: false,
    reconstructabilityProven: false,
    safeToDeleteProven: false,
    reclaimCandidateStatus: 'needs-reviewed-provenance-and-reconstruction-proof',
  },
  boundary: {
    productionDatabaseReadOnly: true,
    productionMutationAuthorized: false,
    deleteAuthorized: false,
    truncateAuthorized: false,
    dropAuthorized: false,
    vacuumAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    r5RearmAuthorized: false,
    r5RestartPerformed: false,
    mainnetEnabled: false,
  },
}

const catalog = evidence.catalog ?? {}
const exactRows = evidence.detail?.exactRowCount ?? null
const summary = [
  '## R5 resource restore read-only reclaim preflight',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- relation: \`${RELATION}\``,
  `- relation present: **${String(evidence.relationPresent)}**`,
  `- exact rows: **${exactRows == null ? 'unknown' : String(exactRows)}**`,
  `- total relation bytes: **${catalog.totalRelationBytes == null ? 'unknown' : String(catalog.totalRelationBytes)}**`,
  `- heap / index / TOAST bytes: **${catalog.heapBytes ?? 'unknown'} / ${catalog.indexBytes ?? 'unknown'} / ${catalog.toastBytes ?? 'unknown'}**`,
  `- dependent routine mentions: **${evidence.detail?.routineMentions?.length ?? 0}**`,
  `- dependent view mentions: **${evidence.detail?.viewMentions?.length ?? 0}**`,
  `- constraints / indexes / user triggers: **${evidence.detail?.constraints?.length ?? 0} / ${evidence.detail?.indexes?.length ?? 0} / ${evidence.detail?.userTriggers?.length ?? 0}**`,
  '- row contents published: **false**',
  '- reconstructability proven: **false**',
  '- safe to delete proven: **false**',
  '- production mutation authorized: **false**',
  '- R5 rearm authorized: **false**',
  '- Mainnet enabled: **false**',
  '',
  'This probe only inventories the relation and its dependency/storage shape. It does not authorize deletion, TRUNCATE, DROP, VACUUM, scheduler/deployment changes, or R5 restart. A separate reviewed provenance and reconstruction proof is required before any reclaim mutation can be proposed.',
  '',
].join('\n')

await writeJson(options.output, evidence)
await writeText(options.summary, summary)
process.stdout.write(`${JSON.stringify(evidence)}\n`)
