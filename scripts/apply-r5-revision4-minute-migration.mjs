import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const migrationPath = argument('--migration') ?? 'supabase/migrations/20260813072000_xrpl_r5_revision4_continuous_head_rebind_fix.sql'
const expectedSha = argument('--expected-sha')
const outputDirectory = argument('--output-directory') ?? 'r5-revision4-minute-activation-evidence'
const version = '20260813072000'
const migrationName = 'xrpl_r5_revision4_continuous_head_rebind_fix'
const previousVersion = '20260813060000'
const expectedPath = `supabase/migrations/${version}_${migrationName}.sql`
const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''

if (migrationPath !== expectedPath) throw new Error(`unexpected minute migration path:${migrationPath}`)
if (!/^[a-f0-9]{64}$/u.test(expectedSha ?? '')) throw new Error('expected migration SHA-256 invalid')
if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID invalid')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN unavailable')

const migration = await readFile(migrationPath, 'utf8')
const actualSha = createHash('sha256').update(migration).digest('hex')
if (actualSha !== expectedSha) throw new Error('minute activation migration source drifted')

for (const required of [
  'create or replace function public.xrpl_refresh_r5_revision4_continuous_head',
  'xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary',
  'active_boundary_drift_requires_operator',
  'invocation_halt_rearmed_and_active_boundary_rebound',
  "v_invocation_halt constant bigint := 400000",
  "'provider_snapshot_stale'",
  "'r5_recovery_monthly_invocation_halt'",
  'claimResourceGuardsStillRequired',
  'to service_role;',
]) {
  if (!migration.includes(required)) throw new Error(`migration missing required contract fragment:${required}`)
}
for (const forbidden of [/\btruncate\b/iu, /\bdelete\s+from\b/iu, /\bdrop\s+table\b/iu, /\bdrop\s+schema\b/iu]) {
  if (forbidden.test(migration)) throw new Error(`migration contains forbidden destructive statement:${forbidden}`)
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

function parseJson(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2000) } }
}
function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API response contains no rows')
}
async function query(sql, parameters = [], readOnly = true) {
  const payload = { query: sql, parameters, read_only: readOnly }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) throw new Error(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}

const prior = await query(
  'select version::text as version from supabase_migrations.schema_migrations where version::text = $1::text',
  [version],
)
if (prior.length !== 0) throw new Error('target minute follow-up migration is already recorded')

const base = await query(
  'select version::text as version from supabase_migrations.schema_migrations where version::text = $1::text',
  [previousVersion],
)
if (base.length !== 1) throw new Error('base continuous-head migration is not recorded exactly once')

const columns = await query(
  `select column_name, data_type, udt_name, is_nullable
     from information_schema.columns
    where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations'
    order by ordinal_position`,
)
const byName = new Map(columns.map((row) => [row.column_name, row]))
for (const name of ['version', 'statements', 'name']) {
  if (!byName.has(name)) throw new Error(`schema_migrations missing required column:${name}`)
}
if (byName.get('version')?.data_type !== 'text') throw new Error('schema_migrations.version is not text')
if (byName.get('statements')?.data_type !== 'ARRAY' || byName.get('statements')?.udt_name !== '_text') {
  throw new Error('schema_migrations.statements is not text[]')
}
if (byName.get('name')?.data_type !== 'text') throw new Error('schema_migrations.name is not text')

const maxBeforeRows = await query('select max(version::text) as max_version from supabase_migrations.schema_migrations')
if (maxBeforeRows.length !== 1 || maxBeforeRows[0].max_version !== previousVersion) {
  throw new Error(`unexpected production migration head before minute activation:${String(maxBeforeRows[0]?.max_version)}`)
}

const statementMarker = `exact-minute-activation-followup sha256:${actualSha}`
const escapedMarker = statementMarker.replaceAll("'", "''")
const escapedName = migrationName.replaceAll("'", "''")
const transaction = [
  'begin;',
  migration,
  `insert into supabase_migrations.schema_migrations(version, statements, name) values ('${version}', array['${escapedMarker}']::text[], '${escapedName}');`,
  'commit;',
].join('\n')

await query(transaction, [], false)

const readback = await query(
  `select version::text as version, statements, name
     from supabase_migrations.schema_migrations
    where version::text = $1::text`,
  [version],
)
if (
  readback.length !== 1
  || readback[0].version !== version
  || readback[0].name !== migrationName
  || !Array.isArray(readback[0].statements)
  || readback[0].statements.length !== 1
  || readback[0].statements[0] !== statementMarker
) throw new Error('minute follow-up migration history readback mismatch')

const functionReadback = await query(
  `select pg_get_functiondef(to_regprocedure('public.xrpl_refresh_r5_revision4_continuous_head(text,bigint,text,timestamp with time zone)')) as definition`,
)
const definition = String(functionReadback[0]?.definition ?? '')
for (const required of [
  'xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary',
  'active_boundary_drift_requires_operator',
  'invocation_halt_rearmed_and_active_boundary_rebound',
]) {
  if (!definition.includes(required)) throw new Error(`continuous-head follow-up readback missing:${required}`)
}

await mkdir(outputDirectory, { recursive: true })
const evidence = {
  schemaVersion: 2,
  purpose: 'r5-revision4-minute-followup-migration-apply',
  migrationPath,
  version,
  migrationName,
  migrationSha256: actualSha,
  previousMaxMigrationVersion: previousVersion,
  statementMarker,
  recorded: true,
  functionPresent: true,
  appliedAt: new Date().toISOString(),
  mainnetDisabled: true,
}
await writeFile(`${outputDirectory}/migration-apply.json`, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence))
