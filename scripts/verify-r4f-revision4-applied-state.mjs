#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const EXPECTED_VERSIONS = [
  '20260809151000',
  '20260810123000',
  '20260810133000',
  '20260811012000',
  '20260811061000',
]

function fail(message) {
  throw new Error(message)
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
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

async function managementQuery(query) {
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
      body: JSON.stringify({ query, parameters: [], read_only: true }),
    },
  )
  const text = await response.text()
  if (!response.ok) {
    fail(`Supabase Management API read-only query failed (${response.status}): ${text.slice(0, 2000)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    fail(`Supabase Management API returned non-JSON response: ${text.slice(0, 1000)}`)
  }
}

const HISTORY_QUERY = `
select version::text as version
from supabase_migrations.schema_migrations
where version::text in (
  '20260809151000',
  '20260810123000',
  '20260810133000',
  '20260811012000',
  '20260811061000'
)
order by version::text;
`.trim()

const STATE_QUERY = `
with function_state as (
  select
    to_regprocedure('public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)') as prepare_oid,
    to_regprocedure('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)') as rebind_strict_oid,
    to_regprocedure('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(text,timestamp with time zone)') as rebind_oid,
    to_regprocedure('public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)') as claim_oid,
    to_regprocedure('public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)') as progressive_claim_oid,
    to_regprocedure('public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)') as completion_oid,
    to_regprocedure('xrpl_r5_v1.revision4_billable_egress_budget_bytes(integer)') as billable_oid,
    to_regprocedure('xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(integer)') as reservation_oid,
    to_regprocedure('public.xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)') as completion_inner_oid,
    to_regprocedure('public.xrpl_read_r5_revision4_accounting_qualification_evidence()') as evidence_reader_oid
), defs as (
  select
    *,
    case when prepare_oid is null then null else pg_get_functiondef(prepare_oid) end as prepare_def,
    case when rebind_strict_oid is null then null else pg_get_functiondef(rebind_strict_oid) end as rebind_strict_def,
    case when rebind_oid is null then null else pg_get_functiondef(rebind_oid) end as rebind_def,
    case when claim_oid is null then null else pg_get_functiondef(claim_oid) end as claim_def,
    case when progressive_claim_oid is null then null else pg_get_functiondef(progressive_claim_oid) end as progressive_claim_def,
    case when completion_oid is null then null else pg_get_functiondef(completion_oid) end as completion_def,
    case when billable_oid is null then null else pg_get_functiondef(billable_oid) end as billable_def,
    case when reservation_oid is null then null else pg_get_functiondef(reservation_oid) end as reservation_def,
    case when completion_inner_oid is null then null else pg_get_functiondef(completion_inner_oid) end as completion_inner_def,
    case when evidence_reader_oid is null then null else pg_get_functiondef(evidence_reader_oid) end as evidence_reader_def
  from function_state
), constraint_state as (
  select
    count(*) = 1 as exists_exactly_once,
    bool_and(not convalidated) as not_validated,
    max(pg_get_constraintdef(oid, true)) as definition
  from pg_constraint
  where conrelid = 'xrpl_r5_v1.recovery_batches'::regclass
    and conname = 'xrpl_r5_revision4_future_egress_budget_check'
), evidence_constraints as (
  select count(*) = 8 as exact_named_constraints
  from pg_constraint
  where conrelid = 'xrpl_r5_v1.revision4_accounting_qualification_evidence'::regclass
    and conname in (
      'xrpl_r5_revision4_accounting_qualification_singleton_check',
      'xrpl_r5_revision4_accounting_qualification_run_check',
      'xrpl_r5_revision4_accounting_qualification_batch_check',
      'xrpl_r5_revision4_accounting_qualification_range_check',
      'xrpl_r5_revision4_accounting_qualification_profile_check',
      'xrpl_r5_revision4_accounting_qualification_digest_check',
      'xrpl_r5_revision4_accounting_qualification_json_bound_check',
      'xrpl_r5_revision4_accounting_qualification_egress_check'
    )
)
select jsonb_build_object(
  'prepareRev4Exists', d.prepare_oid is not null,
  'rebindStrictRev4Exists', d.rebind_strict_oid is not null,
  'rebindRev4Exists', d.rebind_oid is not null,
  'claimRev4Exists', d.claim_oid is not null,
  'progressiveClaimRev4Exists', d.progressive_claim_oid is not null,
  'completionRev4Exists', d.completion_oid is not null,
  'checkpointRows', (select count(*) from xrpl_r5_v1.active_checkpoints where profile_revision = 4),
  'runRows', (select count(*) from xrpl_r5_v1.recovery_runs where profile_revision = 4),
  'batchRows', (select count(*) from xrpl_r5_v1.recovery_batches where profile_revision = 4),
  'runtimeSourceMd5', jsonb_build_object(
    'prepare', md5(d.prepare_def),
    'rebindStrict', md5(d.rebind_strict_def),
    'rebind', md5(d.rebind_def),
    'claim', md5(d.claim_def),
    'progressiveClaim', md5(d.progressive_claim_def),
    'completion', md5(d.completion_def)
  ),
  'egressPolicyRows', (select count(*) from xrpl_r5_v1.revision4_egress_budget_policy),
  'egressPolicyExact', (
    select count(*) = 1
    from xrpl_r5_v1.revision4_egress_budget_policy
    where policy_id = 'r5-revision4-egress-4581-v1'
      and schema_version = 1
      and profile_id = 'supabase_free_postgres_pgcron_edge'
      and profile_revision = 4
      and profile_identity_digest = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
      and maximum_ledgers_per_claim = 12
      and maximum_billable_egress_bytes_per_ledger = 4581
      and maximum_claim_billable_egress_bytes = 54972
      and exclusive_reservation_slack_bytes = 1
      and maximum_claim_exclusive_reservation_bytes = 54973
      and project_egress_halt_31d_bytes = 4294967296
      and required_steady_ledgers_per_minute = 21
      and source_issue_number = 1261
      and public_reader_unchanged is true
      and mainnet_disabled is true
      and stabilization_authorized is false
      and soak_authorized is false
  ),
  'billableHelperExact', d.billable_oid is not null
    and position('p_ledger_count::bigint * 4581' in d.billable_def) > 0,
  'reservationHelperExact', d.reservation_oid is not null
    and position('revision4_billable_egress_budget_bytes(p_ledger_count) + 1' in d.reservation_def) > 0,
  'egressHelperSourceMd5', jsonb_build_object(
    'billable', md5(d.billable_def),
    'reservation', md5(d.reservation_def)
  ),
  'egressConstraintExists', c.exists_exactly_once,
  'egressConstraintNotValidated', coalesce(c.not_validated, false),
  'egressConstraintExact', coalesce(position('revision4_egress_exclusive_reservation_bytes(ledger_count)' in c.definition) > 0, false),
  'egressConstraintMd5', md5(c.definition),
  'claimEgressPatchExact',
    coalesce(position('v_reserved bigint := 0;' in d.claim_def) > 0, false)
    and coalesce(position('v_reserved := xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(v_count);' in d.claim_def) > 0, false)
    and coalesce(position('v_reserved constant bigint := 16777216;' in d.claim_def) = 0, false),
  'evidenceRows', (select count(*) from xrpl_r5_v1.revision4_accounting_qualification_evidence),
  'evidenceNamedConstraintsExact', e.exact_named_constraints,
  'completionInnerExists', d.completion_inner_oid is not null,
  'evidenceReaderExists', d.evidence_reader_oid is not null,
  'completionCaptureWrapperExact',
    coalesce(position('xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture' in d.completion_def) > 0, false)
    and coalesce(position('revision4_accounting_qualification_evidence' in d.completion_def) > 0, false)
    and coalesce(position('if v_batch.ledger_count = 12 then' in d.completion_def) > 0, false),
  'evidenceReaderExact',
    coalesce(position('r4f-revision4-r5-12-ledger-accounting-v1' in d.evidence_reader_def) > 0, false)
    and coalesce(position('r4f-revision4-r5-accounting-qualification-evidence' in d.evidence_reader_def) > 0, false),
  'evidenceSourceMd5', jsonb_build_object(
    'completionInner', md5(d.completion_inner_def),
    'reader', md5(d.evidence_reader_def)
  )
) as state
from defs d
cross join constraint_state c
cross join evidence_constraints e;
`.trim()

function assertMd5Map(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is missing`)
  for (const key of keys) {
    if (!/^[a-f0-9]{32}$/.test(value[key] ?? '')) fail(`${label}.${key} is invalid`)
  }
}

function assertComplete(state) {
  for (const key of [
    'prepareRev4Exists',
    'rebindStrictRev4Exists',
    'rebindRev4Exists',
    'claimRev4Exists',
    'progressiveClaimRev4Exists',
    'completionRev4Exists',
    'egressPolicyExact',
    'billableHelperExact',
    'reservationHelperExact',
    'egressConstraintExists',
    'egressConstraintNotValidated',
    'egressConstraintExact',
    'claimEgressPatchExact',
    'evidenceNamedConstraintsExact',
    'completionInnerExists',
    'evidenceReaderExists',
    'completionCaptureWrapperExact',
    'evidenceReaderExact',
  ]) {
    if (state[key] !== true) fail(`revision-4 applied-state check failed: ${key}=${state[key]}`)
  }

  for (const key of ['checkpointRows', 'runRows', 'batchRows', 'evidenceRows']) {
    if (Number(state[key]) !== 0) fail(`revision-4 applied-state requires ${key}=0, found ${state[key]}`)
  }
  if (Number(state.egressPolicyRows) !== 1) {
    fail(`revision-4 applied-state requires egressPolicyRows=1, found ${state.egressPolicyRows}`)
  }

  assertMd5Map(
    state.runtimeSourceMd5,
    ['prepare', 'rebindStrict', 'rebind', 'claim', 'progressiveClaim', 'completion'],
    'runtimeSourceMd5',
  )
  assertMd5Map(state.egressHelperSourceMd5, ['billable', 'reservation'], 'egressHelperSourceMd5')
  assertMd5Map(state.evidenceSourceMd5, ['completionInner', 'reader'], 'evidenceSourceMd5')
  if (!/^[a-f0-9]{32}$/.test(state.egressConstraintMd5 ?? '')) {
    fail('egressConstraintMd5 is invalid')
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) fail('invalid --source-commit')
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/)

  const historyResponse = await managementQuery(HISTORY_QUERY)
  const versions = []
  const collectVersions = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) collectVersions(entry)
    } else if (value && typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, 'version')) versions.push(String(value.version))
      for (const entry of Object.values(value)) collectVersions(entry)
    }
  }
  collectVersions(historyResponse)
  const migrationVersions = [...new Set(versions)].sort()
  if (JSON.stringify(migrationVersions) !== JSON.stringify(EXPECTED_VERSIONS)) {
    fail(`unexpected revision-4 migration history: ${JSON.stringify(migrationVersions)}`)
  }

  const stateResponse = await managementQuery(STATE_QUERY)
  const state = findFirstKey(stateResponse, 'state')
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('revision-4 applied state is missing')
  assertComplete(state)

  const core = {
    schemaVersion: 1,
    purpose: 'r4f-revision4-exact-already-applied-state-v1',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    migrationVersions,
    state,
    appliedStateComplete: true,
    productionMutation: false,
    mainnetDisabled: true,
    publicReaderUnchanged: true,
  }
  const stateSha256 = sha256(JSON.stringify(canonicalize(core)))
  const result = { ...core, stateSha256 }

  if (options.output) {
    const path = resolve(options.output)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

await main()
