#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const EXPECTED_MIGRATIONS = ['20260811012000', '20260811061000']
const BOUNDARY = '\n--r4f-boundary--\n'

const FUNCTIONS = [
  {
    key: 'prepare',
    signature: 'public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)',
  },
  {
    key: 'rebindStrict',
    signature: 'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)',
  },
  {
    key: 'rebindWrapper',
    signature: 'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(text,timestamp with time zone)',
  },
  {
    key: 'claim',
    signature: 'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)',
  },
  {
    key: 'progressiveClaim',
    signature: 'public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)',
  },
  {
    key: 'completion',
    signature: 'public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)',
  },
]

const ARTIFACTS = {
  egressPolicyTableExists: "to_regclass('xrpl_r5_v1.revision4_egress_budget_policy') is not null",
  egressBillableFunctionExists: "to_regprocedure('xrpl_r5_v1.revision4_billable_egress_budget_bytes(integer)') is not null",
  egressReservationFunctionExists: "to_regprocedure('xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(integer)') is not null",
  egressFutureConstraintExists: "exists (select 1 from pg_constraint where conrelid = 'xrpl_r5_v1.recovery_batches'::regclass and conname = 'xrpl_r5_revision4_future_egress_budget_check')",
  evidenceTableExists: "to_regclass('xrpl_r5_v1.revision4_accounting_qualification_evidence') is not null",
  evidenceInnerCompletionExists: "to_regprocedure('public.xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)') is not null",
  evidenceReaderExists: "to_regprocedure('public.xrpl_read_r5_revision4_accounting_qualification_evidence()') is not null",
}

function fail(message) {
  throw new Error(message)
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function md5(text) {
  return createHash('md5').update(text, 'utf8').digest('hex')
}

function sqlLiteral(text) {
  return `'${String(text).replaceAll("'", "''")}'`
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) fail(`unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = rest[index + 1]
    if (value == null || value.startsWith('--')) fail(`missing value for --${key}`)
    options[key] = value
    index += 1
  }
  return { command, options }
}

function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function findFirstKey(value, key) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstKey(entry, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key]
    for (const entry of Object.values(value)) {
      const found = findFirstKey(entry, key)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function normalizeJsonValue(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

async function managementQuery(query, readOnly) {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/)
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectId}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    },
  )
  const text = await response.text()
  if (!response.ok) {
    fail(`Supabase Management API query failed (${response.status}): ${text.slice(0, 2000)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    fail(`Supabase Management API returned non-JSON response: ${text.slice(0, 1000)}`)
  }
}

function functionDefinitionExpression(signature) {
  const literal = sqlLiteral(signature)
  return `case when to_regprocedure(${literal}) is null then null else pg_get_functiondef(to_regprocedure(${literal})) end`
}

function buildInspectionQuery() {
  const functionEntries = FUNCTIONS
    .map(({ key, signature }) => `${sqlLiteral(key)}, ${functionDefinitionExpression(signature)}`)
    .join(',\n      ')
  const artifactEntries = Object.entries(ARTIFACTS)
    .map(([key, expression]) => `${sqlLiteral(key)}, ${expression}`)
    .join(',\n      ')

  return `
select jsonb_build_object(
  'migrationVersions', coalesce((
    select jsonb_agg(version::text order by version::text)
    from supabase_migrations.schema_migrations
    where version::text in (
      '20260809151000',
      '20260810123000',
      '20260810133000',
      '20260811012000',
      '20260811061000'
    )
  ), '[]'::jsonb),
  'checkpointRows', (select count(*) from xrpl_r5_v1.active_checkpoints where profile_revision = 4),
  'runRows', (select count(*) from xrpl_r5_v1.recovery_runs where profile_revision = 4),
  'batchRows', (select count(*) from xrpl_r5_v1.recovery_batches where profile_revision = 4),
  'functions', jsonb_build_object(
      ${functionEntries}
  ),
  'artifacts', jsonb_build_object(
      ${artifactEntries}
  )
) as state;
`.trim()
}

function assertBaseState(rawState) {
  const state = normalizeJsonValue(rawState)
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('inspection state is missing')
  const migrationVersions = normalizeJsonValue(state.migrationVersions)
  if (!Array.isArray(migrationVersions)) fail('migrationVersions is not an array')
  if (JSON.stringify(migrationVersions) !== JSON.stringify(EXPECTED_MIGRATIONS)) {
    fail(`unexpected migration history: ${JSON.stringify(migrationVersions)}`)
  }
  for (const key of ['checkpointRows', 'runRows', 'batchRows']) {
    if (Number(state[key]) !== 0) fail(`${key} must be zero, found ${state[key]}`)
  }
  const artifacts = normalizeJsonValue(state.artifacts)
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) fail('artifact state is missing')
  for (const key of Object.keys(ARTIFACTS)) {
    if (artifacts[key] !== false) fail(`unexpected egress/evidence partial artifact: ${key}=${artifacts[key]}`)
  }
  const definitions = normalizeJsonValue(state.functions)
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) fail('function state is missing')
  return { state, migrationVersions, artifacts, definitions }
}

function sanitizeInspection({ sourceCommit, projectIdentityDigest, mode, inspected }) {
  const { migrationVersions, artifacts, definitions } = inspected
  const functions = FUNCTIONS.map(({ key, signature }) => {
    const definition = definitions[key]
    const exists = typeof definition === 'string' && definition.length > 0
    return {
      key,
      signature,
      exists,
      sha256: exists ? sha256(definition) : null,
    }
  })

  if (mode === 'residue' && functions.some((entry) => !entry.exists)) {
    fail(`expected all six revision-4 runtime functions to exist: ${JSON.stringify(functions)}`)
  }
  if (mode === 'clean' && functions.some((entry) => entry.exists)) {
    fail(`expected all six revision-4 runtime functions to be absent: ${JSON.stringify(functions)}`)
  }

  const rawDefinitions = FUNCTIONS.map(({ key }) => definitions[key])
  const pgStateMd5 = mode === 'residue' ? md5(rawDefinitions.join(BOUNDARY)) : null
  const canonical = {
    schemaVersion: 1,
    purpose: 'r4f-revision4-runtime-function-residue-cleanup-state',
    sourceCommit,
    projectIdentityDigest,
    expectedState: mode,
    migrationVersions,
    rowCounts: {
      checkpointRows: 0,
      runRows: 0,
      batchRows: 0,
    },
    artifacts,
    functions,
    pgStateMd5,
    noCascade: true,
    migrationHistoryMutationAuthorized: false,
    tableOrRowMutationAuthorized: false,
    collectorMutationAuthorized: false,
    edgeFunctionMutationAuthorized: false,
    mainnetDisabled: true,
  }
  return {
    ...canonical,
    stateSha256: sha256(JSON.stringify(canonical)),
  }
}

function writeJson(path, value) {
  const absolute = resolve(path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function buildCleanupMutation(authorizedPgState) {
  const definitions = FUNCTIONS.map(({ signature }) => functionDefinitionExpression(signature)).join(`,\n      `)
  const existenceChecks = FUNCTIONS
    .map(({ signature }) => `to_regprocedure(${sqlLiteral(signature)}) is null`)
    .join('\n      or ')
  const absenceChecks = FUNCTIONS
    .map(({ signature }) => `to_regprocedure(${sqlLiteral(signature)}) is not null`)
    .join('\n      or ')
  const artifactPresence = Object.values(ARTIFACTS).join('\n      or ')
  const drops = [
    'drop function public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric);',
    'drop function public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer);',
    'drop function public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer);',
    'drop function public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(text,timestamp with time zone);',
    'drop function public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone);',
    'drop function public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone);',
  ].join('\n  ')

  return `
do $r4f_cleanup$
declare
  v_versions text[];
  v_pg_state text;
  v_checkpoint_rows bigint;
  v_run_rows bigint;
  v_batch_rows bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('r4f-revision4-runtime-function-residue-cleanup', 0));

  select array_agg(version::text order by version::text)
  into v_versions
  from supabase_migrations.schema_migrations
  where version::text in (
    '20260809151000',
    '20260810123000',
    '20260810133000',
    '20260811012000',
    '20260811061000'
  );

  if v_versions is distinct from array['20260811012000','20260811061000']::text[] then
    raise exception 'r4f_revision4_residue_cleanup_migration_history_drift';
  end if;

  select count(*) into v_checkpoint_rows from xrpl_r5_v1.active_checkpoints where profile_revision = 4;
  select count(*) into v_run_rows from xrpl_r5_v1.recovery_runs where profile_revision = 4;
  select count(*) into v_batch_rows from xrpl_r5_v1.recovery_batches where profile_revision = 4;

  if v_checkpoint_rows <> 0 or v_run_rows <> 0 or v_batch_rows <> 0 then
    raise exception 'r4f_revision4_residue_cleanup_rows_present';
  end if;

  if ${artifactPresence} then
    raise exception 'r4f_revision4_residue_cleanup_egress_or_evidence_artifact_present';
  end if;

  if ${existenceChecks} then
    raise exception 'r4f_revision4_residue_cleanup_function_missing';
  end if;

  select md5(concat_ws(E'\\n--r4f-boundary--\\n',
      ${definitions}
  ))
  into v_pg_state;

  if v_pg_state <> ${sqlLiteral(authorizedPgState)} then
    raise exception 'r4f_revision4_residue_cleanup_function_source_drift';
  end if;

  ${drops}

  if ${absenceChecks} then
    raise exception 'r4f_revision4_residue_cleanup_post_state_invalid';
  end if;
end;
$r4f_cleanup$;
`.trim()
}

async function inspect(options) {
  const mode = options.expect
  if (!['residue', 'clean'].includes(mode)) fail('--expect must be residue or clean')
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) fail('invalid --source-commit')
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/)
  const projectIdentityDigest = sha256(projectId)
  const response = await managementQuery(buildInspectionQuery(), true)
  const rawState = findFirstKey(response, 'state')
  const inspected = assertBaseState(rawState)
  const sanitized = sanitizeInspection({
    sourceCommit,
    projectIdentityDigest,
    mode,
    inspected,
  })
  if (options.output) writeJson(options.output, sanitized)
  process.stdout.write(`${JSON.stringify(sanitized)}\n`)
}

async function cleanup(options) {
  const authorizedPgState = options['authorized-pgstate']
  if (!/^[a-f0-9]{32}$/.test(authorizedPgState ?? '')) fail('invalid --authorized-pgstate')
  const response = await managementQuery(buildCleanupMutation(authorizedPgState), false)
  const result = {
    schemaVersion: 1,
    purpose: 'r4f-revision4-runtime-function-residue-cleanup-mutation',
    authorizedPgStateMd5: authorizedPgState,
    managementApiSucceeded: true,
    noCascade: true,
    droppedFunctionCount: 6,
    migrationHistoryMutationAuthorized: false,
    tableOrRowMutationAuthorized: false,
    collectorMutationAuthorized: false,
    edgeFunctionMutationAuthorized: false,
    responseShape: Array.isArray(response) ? 'array' : typeof response,
  }
  if (options.output) writeJson(options.output, result)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'inspect') {
  await inspect(options)
} else if (command === 'cleanup') {
  await cleanup(options)
} else {
  fail('usage: r4f-revision4-residue-cleanup.mjs <inspect|cleanup> ...')
}
