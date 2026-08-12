import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const outputPath = process.env.GITHUB_OUTPUT ?? ''
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase()
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? 0)

if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be an exact project ref')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
if (!outputPath) throw new Error('GITHUB_OUTPUT is unavailable')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('checked-out main HEAD must be an exact commit SHA')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId <= 0) throw new Error('GITHUB_RUN_ID must be a positive safe integer')

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const evidenceDirectory = 'r4f-g3-isolated-window-prepare-evidence'

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2_000) }
  }
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API query response does not contain rows')
}

async function readOnlyQuery(query, parameters = []) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(`Supabase Management read-only query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`)
  }
  return rowsFromResponse(body)
}

function integer(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative safe integer`)
  return parsed
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

const projectIdentityDigest = sha256(projectRef)
const jobs = await readOnlyQuery(
  `select jobid, jobname, schedule, command, active, database, username
   from cron.job
   where jobname = $1::text
   order by jobid`,
  ['xrpl-lending-monitor-minute'],
)
if (jobs.length !== 1) throw new Error(`expected one collector cron job, found ${jobs.length}`)
const job = jobs[0]
const jobId = integer(job.jobid, 'collector cron job id')
const jobName = String(job.jobname ?? '')
const schedule = String(job.schedule ?? '')
const command = String(job.command ?? '')
if (jobName !== 'xrpl-lending-monitor-minute') throw new Error('collector cron job name mismatch')
if (schedule !== '* * * * *') throw new Error(`collector cron schedule mismatch:${schedule}`)
if (job.active !== true) throw new Error('collector cron job is not active')
for (const required of [
  "vault.decrypted_secrets",
  "name = 'xrpl_project_url'",
  "'/functions/v1/xrpl-collector-tick'",
  "name = 'xrpl_secret_key'",
  "'source', 'pg_cron'",
]) {
  if (!command.includes(required)) throw new Error(`collector cron command missing required fragment:${required}`)
}
if (/https:\/\/[a-z]{20}\.supabase\.co|sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,}/u.test(command)) {
  throw new Error('collector cron command unexpectedly contains retained credential or project endpoint material')
}
const commandDigest = sha256(command)

const runtimes = await readOnlyQuery(
  `select profile_id, network, status, lease_owner is not null as lease_active,
          lease_expires_at, last_started_at, last_completed_at, last_failed_at,
          last_validated_ledger_index, tick_count, consecutive_failures, updated_at
   from public.xrpl_collector_runtime
   where profile_id = $1::text`,
  ['supabase-devnet'],
)
if (runtimes.length !== 1) throw new Error(`expected one collector runtime row, found ${runtimes.length}`)
const runtime = runtimes[0]
if (runtime.profile_id !== 'supabase-devnet' || runtime.network !== 'devnet') {
  throw new Error('collector runtime identity mismatch')
}
if (!['stopped', 'running', 'halted'].includes(String(runtime.status))) {
  throw new Error('collector runtime status is invalid')
}

const sourceSpecs = [
  {
    key: 'prepare',
    file: 'r5-active-recovery-prepare.sql',
    signature: 'public.xrpl_prepare_r5_active_recovery(text,text,text,bigint,text,timestamp with time zone)',
    anchors: [
      'public.xrpl_prepare_r5_active_recovery(',
      'v_checkpoint.profile_revision <> 3',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
    ],
  },
  {
    key: 'rebindStrict',
    file: 'r5-active-recovery-rebind-strict.sql',
    signature: 'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)',
    anchors: [
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(',
      'v_run.profile_revision <> 3',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
    ],
  },
  {
    key: 'rebindWrapper',
    file: 'r5-active-recovery-rebind-wrapper.sql',
    signature: 'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(text,timestamp with time zone)',
    anchors: [
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'public.xrpl_drain_r5_checkpoint_boundary(',
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(',
      'boundaryDrainBeforeRebind',
    ],
  },
  {
    key: 'claim',
    file: 'r5-active-recovery-claim.sql',
    signature: 'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)',
    anchors: [
      'public.xrpl_claim_r5_active_recovery_batch(',
      'v_run.profile_revision <> 3',
      'v_reserved constant bigint := 134217728',
      'v_count := least(12::bigint',
    ],
  },
  {
    key: 'progressiveClaim',
    file: 'r5-active-recovery-progressive-claim.sql',
    signature: 'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)',
    anchors: [
      'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'public.xrpl_claim_r5_active_recovery_batch(',
      'atomicBoundaryHeldThroughClaim',
    ],
  },
  {
    key: 'completion',
    file: 'r5-active-recovery-completion.sql',
    signature: 'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)',
    anchors: [
      'public.xrpl_complete_r5_active_recovery_batch(',
      "v_accounting_input := v_accounting->'input';",
      'normalizedRecordCount',
      'r5_recovery_batch_accounting_checks_invalid',
    ],
  },
]

const sourceValues = sourceSpecs
  .map((source) => `('${source.key}', '${source.signature.replaceAll("'", "''")}')`)
  .join(',\n       ')
const sourceRows = await readOnlyQuery(
  `with requested(source_key, signature) as (
     values ${sourceValues}
   )
   select source_key, signature,
          pg_get_functiondef(to_regprocedure(signature)) as definition
   from requested
   order by source_key`,
)
if (sourceRows.length !== sourceSpecs.length) {
  throw new Error(`expected ${sourceSpecs.length} R5 runtime source rows, found ${sourceRows.length}`)
}

const rowsByKey = new Map(sourceRows.map((row) => [String(row.source_key ?? ''), row]))
const runtimeSources = []
for (const source of sourceSpecs) {
  const row = rowsByKey.get(source.key)
  if (!row || String(row.signature ?? '') !== source.signature) {
    throw new Error(`R5 runtime source identity mismatch:${source.key}`)
  }
  const definition = String(row.definition ?? '')
  if (!definition) throw new Error(`R5 runtime source definition unavailable:${source.key}`)
  const anchors = Object.fromEntries(source.anchors.map((anchor) => [anchor, definition.includes(anchor)]))
  if (!Object.values(anchors).every(Boolean)) {
    throw new Error(`R5 runtime source fails exact migration anchors:${source.key}:${JSON.stringify(anchors)}`)
  }
  runtimeSources.push({
    key: source.key,
    signature: source.signature,
    file: source.file,
    sha256: sha256(definition),
    anchors,
    definition,
  })
}

const canonicalSourceSet = JSON.stringify(runtimeSources.map(({ key, signature, sha256: sourceSha }) => ({
  key,
  signature,
  sha256: sourceSha,
})))
const runtimeSourceSetSha256 = sha256(canonicalSourceSet)
const prepareSource = runtimeSources.find((source) => source.key === 'prepare')
if (!prepareSource) throw new Error('R5 prepare source is missing from runtime source set')

const partialStateRows = await readOnlyQuery(
  `select jsonb_build_object(
     'prepareRev4Exists', to_regprocedure('public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)') is not null,
     'rebindStrictRev4Exists', to_regprocedure('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)') is not null,
     'rebindRev4Exists', to_regprocedure('public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(text,timestamp with time zone)') is not null,
     'claimRev4Exists', to_regprocedure('public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)') is not null,
     'progressiveClaimRev4Exists', to_regprocedure('public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)') is not null,
     'completionRev4Exists', to_regprocedure('public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)') is not null,
     'checkpointRows', (select count(*) from xrpl_r5_v1.active_checkpoints where profile_revision = 4),
     'runRows', (select count(*) from xrpl_r5_v1.recovery_runs where profile_revision = 4),
     'batchRows', (select count(*) from xrpl_r5_v1.recovery_batches where profile_revision = 4)
   ) as state`,
)
if (partialStateRows.length !== 1 || !partialStateRows[0]?.state || typeof partialStateRows[0].state !== 'object') {
  throw new Error('revision-4 partial-state preflight response is invalid')
}
const rawPartialState = partialStateRows[0].state
const revision4PartialState = {
  prepareRev4Exists: rawPartialState.prepareRev4Exists === true,
  rebindStrictRev4Exists: rawPartialState.rebindStrictRev4Exists === true,
  rebindRev4Exists: rawPartialState.rebindRev4Exists === true,
  claimRev4Exists: rawPartialState.claimRev4Exists === true,
  progressiveClaimRev4Exists: rawPartialState.progressiveClaimRev4Exists === true,
  completionRev4Exists: rawPartialState.completionRev4Exists === true,
  checkpointRows: nonNegativeInteger(rawPartialState.checkpointRows, 'revision-4 checkpoint row count'),
  runRows: nonNegativeInteger(rawPartialState.runRows, 'revision-4 run row count'),
  batchRows: nonNegativeInteger(rawPartialState.batchRows, 'revision-4 batch row count'),
}

await mkdir(evidenceDirectory, { recursive: true })
for (const source of runtimeSources) {
  await writeFile(
    `${evidenceDirectory}/${source.file}`,
    source.definition.endsWith('\n') ? source.definition : `${source.definition}\n`,
  )
}
const evidence = {
  schemaVersion: 5,
  purpose: 'r4f-g3-isolated-window-scheduler-prepare',
  sourceRunId,
  sourceCommit,
  observedAt: new Date().toISOString(),
  projectIdentityDigest,
  scheduler: {
    jobId,
    jobName,
    schedule,
    commandDigest,
    active: true,
    database: String(job.database ?? ''),
    username: String(job.username ?? ''),
    commandRetained: false,
  },
  collectorRuntime: {
    profileId: runtime.profile_id,
    network: runtime.network,
    status: runtime.status,
    leaseActive: runtime.lease_active === true,
    leaseExpiresAt: runtime.lease_expires_at ?? null,
    lastStartedAt: runtime.last_started_at ?? null,
    lastCompletedAt: runtime.last_completed_at ?? null,
    lastFailedAt: runtime.last_failed_at ?? null,
    lastValidatedLedgerIndex: runtime.last_validated_ledger_index == null ? null : Number(runtime.last_validated_ledger_index),
    tickCount: Number(runtime.tick_count),
    consecutiveFailures: Number(runtime.consecutive_failures),
    updatedAt: runtime.updated_at ?? null,
  },
  revision4PartialState,
  r5PrepareSource: {
    sha256: prepareSource.sha256,
    anchors: prepareSource.anchors,
    sourceRetainedInArtifact: true,
  },
  r5RuntimeSourceSet: {
    sha256: runtimeSourceSetSha256,
    canonicalSourceSet,
    sources: runtimeSources.map(({ key, signature, file, sha256: sourceSha, anchors }) => ({
      key,
      signature,
      file,
      sha256: sourceSha,
      anchors,
      sourceRetainedInArtifact: true,
    })),
    allDynamicCloneSourcesBound: true,
  },
  checks: {
    exactNamedCollectorCron: true,
    oneMinuteCadence: true,
    vaultReferencesOnly: true,
    collectorFunctionPathPinned: true,
    checkedOutMainHeadRetained: true,
    projectRefRetained: false,
    credentialsRetained: false,
    readOnlyManagementQuery: true,
    providerMutationPerformed: false,
    databaseMutationPerformed: false,
    recoveryMutationCommitted: false,
    mainnetDisabled: true,
  },
}
await writeFile(`${evidenceDirectory}/scheduler-prepare.json`, `${JSON.stringify(evidence, null, 2)}\n`)
await writeFile(
  outputPath,
  [
    `source_commit=${sourceCommit}`,
    `job_id=${jobId}`,
    `job_name=${jobName}`,
    `schedule=${schedule}`,
    `command_digest=${commandDigest}`,
    `project_digest=${projectIdentityDigest}`,
    `runtime_status=${runtime.status}`,
    `runtime_tick_count=${Number(runtime.tick_count)}`,
    `r5_prepare_source_definition_sha256=${prepareSource.sha256}`,
    `r5_prepare_source_sha256=${runtimeSourceSetSha256}`,
    `r5_runtime_source_set_sha256=${runtimeSourceSetSha256}`,
    '',
  ].join('\n'),
  { flag: 'a' },
)
process.stdout.write(`${JSON.stringify({
  sourceCommit,
  jobId,
  jobName,
  schedule,
  commandDigest,
  projectIdentityDigest,
  runtimeStatus: runtime.status,
  runtimeTickCount: Number(runtime.tick_count),
  revision4PartialState,
  r5PrepareSourceDefinitionSha256: prepareSource.sha256,
  r5RuntimeSourceSetSha256: runtimeSourceSetSha256,
  runtimeSources: runtimeSources.map(({ key, signature, sha256: sourceSha }) => ({ key, signature, sha256: sourceSha })),
})}\n`)