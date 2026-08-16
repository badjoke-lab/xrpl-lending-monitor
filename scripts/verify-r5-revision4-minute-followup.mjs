import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const outputPath = process.argv[2] ?? 'r5-revision4-minute-activation-evidence/followup-verification.json'
const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const version = '20260813072000'
const minuteRunBindingVersion = '20260816020000'
const completionCaptureGuardVersion = '20260816040000'
const minuteRunId = 'r5-recovery-selected-revision4-minute-entry'
const approvedCurrentMigrationVersions = new Set([
  version,
  '20260813142000',
  '20260814130000',
  '20260815211500',
  minuteRunBindingVersion,
  completionCaptureGuardVersion,
])
const minuteBindingCurrentVersions = new Set([
  minuteRunBindingVersion,
  completionCaptureGuardVersion,
])
const migrationName = 'xrpl_r5_revision4_continuous_head_rebind_fix'
const migrationPath = `supabase/migrations/${version}_${migrationName}.sql`
const signature = 'public.xrpl_refresh_r5_revision4_continuous_head(text,bigint,text,timestamp with time zone)'

if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID invalid')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN unavailable')

const migration = await readFile(migrationPath, 'utf8')
const migrationSha256 = createHash('sha256').update(migration).digest('hex')
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function parseJson(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2000) } }
}
function rows(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const value of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(value)) return value
    }
  }
  throw new Error('Management API response contains no rows')
}
async function query(sql, parameters = []) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: sql, parameters, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) throw new Error(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 1200)}`)
  return rows(body)
}

const history = await query(
  `select version::text as version, statements, name
     from supabase_migrations.schema_migrations
    where version::text = $1::text`,
  [version],
)
if (history.length !== 1) throw new Error(`follow-up migration history expected once, found ${history.length}`)
const row = history[0]
if (row.version !== version || row.name !== migrationName) throw new Error('follow-up migration identity mismatch')
if (!Array.isArray(row.statements) || row.statements.length !== 4) {
  throw new Error(`follow-up migration expected four Supabase statements, found ${Array.isArray(row.statements) ? row.statements.length : 'non-array'}`)
}
const historyStatements = row.statements.map((value) => String(value))
const strippedStatements = historyStatements.map((value) => value.replace(/;\s*$/u, ''))
const reconstructionCandidates = new Map()
for (const statements of [historyStatements, strippedStatements]) {
  for (const separator of [';\n\n', ';\n']) {
    for (const ending of [';\n', ';']) {
      const reconstructed = statements.join(separator) + ending
      reconstructionCandidates.set(sha256(reconstructed), { separator, ending, stripped: statements === strippedStatements })
    }
  }
}
const exactReconstruction = reconstructionCandidates.get(migrationSha256) ?? null
if (!exactReconstruction) {
  throw new Error(`split Supabase migration history does not reconstruct repository source; migrationSha=${migrationSha256} candidateShas=${[...reconstructionCandidates.keys()].join(',')}`)
}

const maxRows = await query('select max(version::text) as max_version from supabase_migrations.schema_migrations')
if (maxRows.length !== 1) throw new Error('migration max query returned unexpected rows')
const currentMaxMigrationVersion = String(maxRows[0].max_version ?? '')
if (!approvedCurrentMigrationVersions.has(currentMaxMigrationVersion)) {
  throw new Error(`unreviewed migration exists after minute follow-up:${currentMaxMigrationVersion}`)
}
const minuteRunBindingRegistered = minuteBindingCurrentVersions.has(currentMaxMigrationVersion)
const completionCaptureGuardRegistered = currentMaxMigrationVersion === completionCaptureGuardVersion

const functionRows = await query(
  `select p.prosecdef as security_definer,
          pg_get_functiondef(p.oid) as definition,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
     from pg_proc p where p.oid = to_regprocedure($1::text)`,
  [signature],
)
if (functionRows.length !== 1) throw new Error('continuous-head function missing after follow-up')
const fn = functionRows[0]
const definition = String(fn.definition ?? '')
for (const marker of [
  'xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary',
  'active_boundary_drift_requires_operator',
  'invocation_halt_rearmed_and_active_boundary_rebound',
  'v_invocation_halt constant bigint := 400000',
  'claimResourceGuardsStillRequired',
  'mainnetDisabled',
]) {
  if (!definition.includes(marker)) throw new Error(`continuous-head applied marker missing:${marker}`)
}
if (minuteRunBindingRegistered && !definition.includes(minuteRunId)) {
  throw new Error('continuous-head minute run binding missing after registered rollover migration')
}
if (fn.security_definer !== true || fn.anon_execute !== false || fn.authenticated_execute !== false || fn.service_role_execute !== true) {
  throw new Error('continuous-head applied ACL mismatch')
}

const evidence = {
  schemaVersion: 6,
  purpose: 'r5-revision4-minute-followup-provenance',
  version,
  migrationName,
  migrationPath,
  migrationSha256,
  historyStatementCount: historyStatements.length,
  historyStatementsSha256: sha256(JSON.stringify(historyStatements)),
  historyExact: true,
  historyStorageShape: 'supabase_split_statements',
  reconstruction: exactReconstruction,
  currentMaxMigrationVersion,
  currentMaxVersionApproved: true,
  minuteRunBindingRegistered,
  completionCaptureGuardRegistered,
  approvedCurrentMigrationVersions: [...approvedCurrentMigrationVersions],
  functionDefinitionSha256: sha256(definition),
  functionContractVerified: true,
  resourceGuardUnchanged: true,
  mainnetDisabled: true,
  checkedAt: new Date().toISOString(),
}
await mkdir(outputPath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence))