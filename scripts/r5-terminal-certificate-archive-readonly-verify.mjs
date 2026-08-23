import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function fail(message) {
  throw new Error(message)
}

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
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) {
      fail(`invalid argument near ${key ?? '<end>'}`)
    }
    out[key.slice(2)] = value
  }
  return out
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

const PREPARE_CONTRACT_PATH =
  'ops/production-sql/20260824012500_xrpl_terminal_certificate_archive_atomic_prepare_contract.json'

const FUNCTIONS = [
  [
    'caughtUpScan',
    'public.xrpl_complete_caught_up_scan(text,text,timestamp with time zone)',
  ],
  [
    'portableScan',
    'public.xrpl_complete_portable_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,text)',
  ],
  [
    'portableFinalize',
    'public.xrpl_complete_portable_finalize_phase(text,text,timestamp with time zone)',
  ],
  [
    'r5Revision4Complete',
    'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)',
  ],
  [
    'genericScan',
    'public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,bigint,text,text,integer)',
  ],
  [
    'genericFinalize',
    'public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)',
  ],
  ['duplicateCompletion', 'xrpl_phase_archive_v1.duplicate_completion(text,text)'],
  [
    'scanMessageId',
    'public.xrpl_phase_scan_message_id(text,text,text,bigint,text,integer)',
  ],
  ['workId', 'public.xrpl_phase_work_id(text,text,text,bigint,text)'],
  ['commitMessageId', 'public.xrpl_phase_commit_message_id(text,integer)'],
  ['finalizeMessageId', 'public.xrpl_phase_finalize_message_id(text)'],
]

const functionValues = FUNCTIONS.map(
  ([key, signature]) => `(${quoteSql(key)},${quoteSql(signature)})`,
).join(',\n    ')

const SQL = String.raw`with function_targets(logical_key, signature) as (
  values
    ${functionValues}
), function_state as (
  select
    t.logical_key,
    t.signature,
    pg_get_functiondef(t.signature::regprocedure) as definition,
    p.prosrc as source,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
    coalesce(to_jsonb(p.proconfig),'[]'::jsonb) as settings
  from function_targets t
  join pg_proc p on p.oid=t.signature::regprocedure
), column_state as (
  select
    a.attrelid::regclass::text as relation_name,
    a.attname as column_name,
    format_type(a.atttypid,a.atttypmod) as data_type,
    a.attnotnull as not_null,
    pg_get_expr(d.adbin,d.adrelid) as default_expression,
    coalesce((
      select jsonb_agg(pg_get_constraintdef(c.oid,true) order by c.conname)
      from pg_constraint c
      where c.conrelid=a.attrelid
        and c.contype='c'
        and pg_get_constraintdef(c.oid,true) like '%'||a.attname||'%'
    ),'[]'::jsonb) as check_definitions
  from pg_attribute a
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where (a.attrelid='public.xrpl_phase_work'::regclass and a.attname='source_scan_sequence')
     or (a.attrelid='public.xrpl_phase_streams'::regclass and a.attname='next_scan_sequence')
    and not a.attisdropped
), work_state as (
  select
    count(*) as committed_work_count,
    count(*) filter(where source_scan_sequence<>0) as nonzero_source_sequence_count,
    case when count(*)=0 then null else encode(
      extensions.digest(
        convert_to(
          string_agg(work_id||':'||source_scan_sequence::text,E'\n' order by work_id),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) end as mapping_digest
  from public.xrpl_phase_work
  where profile_id='supabase-devnet'
    and status='committed'
), active_scan_state as (
  select
    count(*) as row_count,
    coalesce(jsonb_agg(
      case
        when payload->>'scanSequence' ~ '^(0|[1-9][0-9]*)$'
          then (payload->>'scanSequence')::bigint
        else null
      end
      order by message_id
    ),'[]'::jsonb) as sequences
  from public.xrpl_phase_messages
  where profile_id='supabase-devnet'
    and phase='scan'
    and status in ('pending','leased','retry')
), active_stream_state as (
  select
    count(*) as row_count,
    coalesce(jsonb_agg(next_scan_sequence order by profile_id),'[]'::jsonb) as sequences
  from public.xrpl_phase_streams
  where profile_id='supabase-devnet'
    and status='active'
), transport_state as (
  select
    (select count(*) from xrpl_phase_archive_v1.terminal_messages a where a.profile_id='supabase-devnet')
      + (select count(*) from public.xrpl_phase_messages m where m.profile_id='supabase-devnet')
      as transport_rows,
    (select count(*)
      from xrpl_phase_archive_v1.terminal_messages a
      join public.xrpl_phase_messages m on m.message_id=a.message_id
      where a.profile_id='supabase-devnet'
        and m.profile_id='supabase-devnet') as duplicate_message_ids
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'functions',(
    select jsonb_object_agg(logical_key,jsonb_build_object(
      'signature',signature,
      'definition',definition,
      'source',source,
      'owner',owner,
      'securityDefiner',security_definer,
      'serviceRoleExecute',service_role_execute,
      'settings',settings
    ) order by logical_key)
    from function_state
  ),
  'columns',coalesce((
    select jsonb_object_agg(relation_name||'.'||column_name,jsonb_build_object(
      'dataType',data_type,
      'notNull',not_null,
      'defaultExpression',default_expression,
      'checkDefinitions',check_definitions
    ) order by relation_name,column_name)
    from column_state
  ),'{}'::jsonb),
  'committedWorkCount',(select committed_work_count from work_state),
  'nonzeroSourceSequenceCount',(select nonzero_source_sequence_count from work_state),
  'mappingDigest',(select mapping_digest from work_state),
  'activeScanRows',(select row_count from active_scan_state),
  'activeScanSequences',(select sequences from active_scan_state),
  'activeStreamRows',(select row_count from active_stream_state),
  'activeStreamSequences',(select sequences from active_stream_state),
  'transportRows',(select transport_rows from transport_state),
  'transportDuplicateMessageIds',(select duplicate_message_ids from transport_state)
)::text as state;`

if (!/^\s*with\b/iu.test(SQL)) fail('independent verifier must be SELECT/read_only only')
if (/\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu.test(SQL)) {
  fail('independent verifier contains a mutation statement')
}

async function query(sql) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    fail(`non-json Management API response: ${text.slice(0, 500)}`)
  }
  if (!response.ok) fail(`Management API query failed: ${response.status} ${text.slice(0, 500)}`)
  return body
}

function oneColumn(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail('unexpected independent verifier row count')
  const keys = Object.keys(rows[0] ?? {})
  if (keys.length !== 1) fail('unexpected independent verifier shape')
  return rows[0][keys[0]]
}

function addCheck(checks, name, passed, actual, expected) {
  checks.push({ name, passed: Boolean(passed), actual, expected })
}

function checkColumn(checks, state, key, expectedName) {
  const column = state.columns?.[key]
  addCheck(checks, `${expectedName}.present`, Boolean(column), Boolean(column), true)
  if (!column) return
  addCheck(checks, `${expectedName}.dataType`, column.dataType === 'integer', column.dataType, 'integer')
  addCheck(checks, `${expectedName}.notNull`, column.notNull === true, column.notNull, true)
  addCheck(
    checks,
    `${expectedName}.defaultZero`,
    /^0(?:::\w+)?$/u.test(String(column.defaultExpression ?? '')),
    column.defaultExpression,
    '0',
  )
  const checkDefinitions = Array.isArray(column.checkDefinitions) ? column.checkDefinitions : []
  addCheck(
    checks,
    `${expectedName}.nonnegativeCheck`,
    checkDefinitions.some(
      (definition) => String(definition).includes(expectedName) && String(definition).includes('>= 0'),
    ),
    checkDefinitions,
    `${expectedName} >= 0`,
  )
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
const outputDir = resolve(options['output-dir'] ?? 'r5-terminal-certificate-archive-readonly-verify')
const contractPath = resolve(options['prepare-contract'] ?? PREPARE_CONTRACT_PATH)
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const contract = JSON.parse(await readFile(contractPath, 'utf8'))
if (contract.purpose !== 'xrpl-terminal-certificate-archive-atomic-production-prepare') {
  fail('unexpected prepare contract purpose')
}
if (contract.independentReadOnlyVerify?.required !== true) fail('independent read-only verify is not required')
if (contract.independentReadOnlyVerify?.mustUseReadOnlyDatabaseAccess !== true) {
  fail('prepare contract does not require read-only database access')
}
if (contract.r5RearmAuthorized !== false || contract.mainnetEnabled !== false) {
  fail('prepare contract runtime safety flags drifted')
}

const raw = oneColumn(await query(SQL))
const state = typeof raw === 'string' ? JSON.parse(raw) : raw
if (!state || typeof state !== 'object') fail('independent verifier state missing')

const checks = []
checkColumn(
  checks,
  state,
  'xrpl_phase_work.source_scan_sequence',
  'source_scan_sequence',
)
checkColumn(
  checks,
  state,
  'xrpl_phase_streams.next_scan_sequence',
  'next_scan_sequence',
)

for (const [key, expected] of Object.entries(contract.expectedAfter.functionDefinitionSha256)) {
  const row = state.functions?.[key]
  addCheck(checks, `${key}.present`, Boolean(row), Boolean(row), true)
  if (!row) continue
  addCheck(checks, `${key}.definitionSha256`, sha256(row.definition) === expected, sha256(row.definition), expected)
  addCheck(checks, `${key}.owner`, row.owner === 'postgres', row.owner, 'postgres')
  addCheck(checks, `${key}.serviceRoleExecute`, row.serviceRoleExecute === true, row.serviceRoleExecute, true)
}

for (const [key, expected] of Object.entries(
  contract.expectedAfter.identityHelperDefinitionSha256Unchanged,
)) {
  const row = state.functions?.[key]
  addCheck(checks, `${key}.present`, Boolean(row), Boolean(row), true)
  if (!row) continue
  addCheck(checks, `${key}.definitionSha256`, sha256(row.definition) === expected, sha256(row.definition), expected)
}

const duplicate = state.functions?.duplicateCompletion
addCheck(checks, 'duplicateCompletion.present', Boolean(duplicate), Boolean(duplicate), true)
if (duplicate) {
  const expected = contract.expectedAfter.duplicateCompletion
  const settings = Array.isArray(duplicate.settings) ? duplicate.settings : []
  addCheck(
    checks,
    'duplicateCompletion.sourceSha256',
    sha256(duplicate.source) === expected.sourceSha256,
    sha256(duplicate.source),
    expected.sourceSha256,
  )
  addCheck(checks, 'duplicateCompletion.owner', duplicate.owner === expected.owner, duplicate.owner, expected.owner)
  addCheck(
    checks,
    'duplicateCompletion.securityDefiner',
    duplicate.securityDefiner === expected.securityDefiner,
    duplicate.securityDefiner,
    expected.securityDefiner,
  )
  addCheck(
    checks,
    'duplicateCompletion.serviceRoleDirectExecute',
    duplicate.serviceRoleExecute === expected.serviceRoleDirectExecute,
    duplicate.serviceRoleExecute,
    expected.serviceRoleDirectExecute,
  )
  addCheck(
    checks,
    'duplicateCompletion.searchPath',
    settings.includes(`search_path=${expected.searchPath}`),
    settings,
    `search_path=${expected.searchPath}`,
  )
}

const prestate = contract.productionEvidence.prestate
addCheck(
  checks,
  'historical.committedWorkCount',
  state.committedWorkCount === prestate.productiveScanRows,
  state.committedWorkCount,
  prestate.productiveScanRows,
)
addCheck(
  checks,
  'historical.nonzeroSourceSequenceCount',
  state.nonzeroSourceSequenceCount === 0,
  state.nonzeroSourceSequenceCount,
  0,
)
addCheck(
  checks,
  'historical.mappingDigest',
  state.mappingDigest === prestate.productiveMappingDigest,
  state.mappingDigest,
  prestate.productiveMappingDigest,
)
addCheck(
  checks,
  'transport.duplicateMessageIds',
  state.transportDuplicateMessageIds === prestate.transportDuplicateMessageIds,
  state.transportDuplicateMessageIds,
  prestate.transportDuplicateMessageIds,
)
addCheck(
  checks,
  'activeScan.sequences',
  JSON.stringify(state.activeScanSequences) === JSON.stringify(prestate.activeScanSequences),
  state.activeScanSequences,
  prestate.activeScanSequences,
)
addCheck(
  checks,
  'activeStream.sequences',
  Array.isArray(state.activeStreamSequences) &&
    state.activeStreamSequences.length > 0 &&
    state.activeStreamSequences.every((value) => value === 0),
  state.activeStreamSequences,
  'all active stream sequences = 0',
)

const failedChecks = checks.filter((check) => !check.passed)
const evidence = {
  schemaVersion: 1,
  purpose: 'xrpl-terminal-certificate-archive-independent-readonly-verify',
  sourceCommit,
  prepareContractPath: options['prepare-contract'] ?? PREPARE_CONTRACT_PATH,
  executionCommit: contract.executionCommit,
  atomicBundleSha256: contract.atomicBundle.bundleSha256,
  prepareRun: contract.productionEvidence.readOnlyRunId,
  productionDatabaseReadOnly: true,
  productionMutationAuthorized: false,
  schedulerMutationAuthorized: false,
  publicReaderMutationAuthorized: false,
  archiveDeletionAuthorized: false,
  r5RearmAuthorized: false,
  mainnetEnabled: false,
  passed: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  checks,
  observed: {
    databaseBytes: state.databaseBytes,
    transportRows: state.transportRows,
    committedWorkCount: state.committedWorkCount,
    mappingDigest: state.mappingDigest,
    activeScanRows: state.activeScanRows,
    activeScanSequences: state.activeScanSequences,
    activeStreamRows: state.activeStreamRows,
    activeStreamSequences: state.activeStreamSequences,
  },
}

await mkdir(outputDir, { recursive: true })
const serialized = `${JSON.stringify(evidence, null, 2)}\n`
const digest = sha256(serialized)
await writeFile(`${outputDir}/terminal-certificate-archive-readonly-verify-evidence.json`, serialized)
await writeFile(`${outputDir}/terminal-certificate-archive-readonly-verify-evidence.sha256`, `${digest}\n`)

const summary = [
  '## Terminal certificate/archive independent read-only verify',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- execution commit: \`${contract.executionCommit}\``,
  `- atomic bundle SHA-256: \`${contract.atomicBundle.bundleSha256}\``,
  `- prepare run: \`${contract.productionEvidence.readOnlyRunId}\``,
  `- verification passed: \`${evidence.passed}\``,
  `- failed checks: \`${failedChecks.length}\``,
  `- committed historical work rows: \`${state.committedWorkCount}\``,
  `- historical mapping digest: \`${state.mappingDigest}\``,
  `- transport duplicate message IDs: \`${state.transportDuplicateMessageIds}\``,
  `- active scan sequences: \`${JSON.stringify(state.activeScanSequences)}\``,
  `- active stream sequences: \`${JSON.stringify(state.activeStreamSequences)}\``,
  '- database access: `read_only=true`',
  '- production mutation: `false`',
  '- R5 rearm: `false`',
  '- Mainnet action: `false`',
  '',
  `Evidence SHA-256: \`${digest}\``,
].join('\n')
await writeFile(`${outputDir}/terminal-certificate-archive-readonly-verify-summary.md`, `${summary}\n`)
console.log(summary)

if (failedChecks.length > 0) {
  fail(`independent read-only verify failed: ${failedChecks.map((check) => check.name).join(',')}`)
}
