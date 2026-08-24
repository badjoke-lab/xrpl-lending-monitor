#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const GUARD_PATH =
  'ops/production-sql/20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json'
const MANIFEST_PATH =
  'ops/production-sql/20260823053000_xrpl_terminal_certificate_archive_atomic_manifest.json'

const FUNCTION_SIGNATURES = {
  caughtUpScan: 'public.xrpl_complete_caught_up_scan(text,text,timestamp with time zone)',
  portableScan:
    'public.xrpl_complete_portable_scan_phase(text,text,timestamp with time zone,bigint,text,text,text,text,text)',
  portableFinalize:
    'public.xrpl_complete_portable_finalize_phase(text,text,timestamp with time zone)',
  r5Revision4Complete:
    'public.xrpl_complete_r5_revision4_recovery_batch_without_qualification(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)',
  genericScan:
    'public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,bigint,text,text,integer)',
  genericFinalize:
    'public.xrpl_complete_finalize_phase(text,text,timestamp with time zone)',
  duplicateCompletion: 'xrpl_phase_archive_v1.duplicate_completion(text,text)',
  scanMessageId:
    'public.xrpl_phase_scan_message_id(text,text,text,bigint,text,integer)',
  workId: 'public.xrpl_phase_work_id(text,text,text,bigint,text)',
  commitMessageId: 'public.xrpl_phase_commit_message_id(text,integer)',
  finalizeMessageId: 'public.xrpl_phase_finalize_message_id(text)',
}

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) {
      fail(`invalid argument near ${key ?? '<end>'}`)
    }
    options[key.slice(2)] = value
  }
  return { command, options }
}

function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

async function managementQuery(query, readOnly) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 2000) }
  }
  if (!response.ok) {
    fail(`Supabase Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  }
  return { body, rows: rowsFromResponse(body) }
}

async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

async function loadJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}

function stripOuterTransaction(sql, path) {
  const normalized = sql.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('begin;\n')) fail(`${path}: exact leading begin; boundary missing`)
  if (!/\ncommit;\n?$/u.test(normalized)) fail(`${path}: exact trailing commit; boundary missing`)
  const body = normalized.slice('begin;\n'.length).replace(/\ncommit;\n?$/u, '\n')
  if (/^begin;$/gmu.test(body) || /^commit;$/gmu.test(body)) {
    fail(`${path}: unexpected standalone transaction boundary inside stage body`)
  }
  return body
}

async function loadExactBundle(guard) {
  const manifest = await loadJson(MANIFEST_PATH)
  if (manifest.bundleSha256 !== guard.bundleSha256) fail('guard/manifest bundle digest mismatch')
  const stages = []
  for (const [index, stage] of manifest.orderedStages.entries()) {
    if (stage.order !== index + 1) fail('atomic manifest stage order drifted')
    const sql = await readFile(resolve(stage.path), 'utf8')
    if (sha256(sql) !== stage.sha256) fail(`atomic stage SHA drifted: ${stage.path}`)
    stages.push({ ...stage, body: stripOuterTransaction(sql, stage.path) })
  }
  const bundle = [
    'begin;',
    '-- Repository-generated atomic review bundle only.',
    '-- Executing this file is NOT authorized by generation or merge.',
    '-- Production requires Issue #1261 prepare -> exact OWNER authorization -> bounded apply -> independent read-only verify.',
    ...stages.flatMap((stage) => [
      '',
      `-- atomic stage ${stage.order}: ${stage.path}`,
      `-- exact source sha256: ${stage.sha256}`,
      stage.body.trimEnd(),
    ]),
    '',
    'commit;',
    '',
  ].join('\n')
  const digest = sha256(bundle)
  if (digest !== guard.bundleSha256) fail(`regenerated atomic bundle SHA drifted: ${digest}`)
  if ((bundle.match(/^begin;$/gmu)?.length ?? 0) !== 1) fail('atomic bundle BEGIN count drifted')
  if ((bundle.match(/^commit;$/gmu)?.length ?? 0) !== 1) fail('atomic bundle COMMIT count drifted')
  return { manifest, bundle, digest }
}

function functionInspectionSql() {
  const rows = Object.entries(FUNCTION_SIGNATURES)
    .map(([key, signature]) => `(${quoteSql(key)},${quoteSql(signature)})`)
    .join(',\n    ')
  return `with targets(logical_key,signature) as (
    values
    ${rows}
  ), state as (
    select
      t.logical_key,
      pg_get_functiondef(p.oid) as definition,
      p.prosrc as source,
      pg_get_userbyid(p.proowner) as owner,
      p.prosecdef as security_definer,
      coalesce(to_jsonb(p.proconfig),'[]'::jsonb) as settings,
      exists(
        select 1
        from aclexplode(coalesce(p.proacl,'{}'::aclitem[])) acl
        join pg_roles role on role.oid=acl.grantee
        where role.rolname='service_role' and acl.privilege_type='EXECUTE'
      ) as service_role_direct_execute
    from targets t
    join pg_proc p on p.oid=t.signature::regprocedure
  )
  select jsonb_build_object(
    'functions',jsonb_object_agg(logical_key,jsonb_build_object(
      'definition',definition,
      'source',source,
      'owner',owner,
      'securityDefiner',security_definer,
      'settings',settings,
      'serviceRoleDirectExecute',service_role_direct_execute
    ) order by logical_key),
    'certificateColumnCount',(
      select count(*)
      from information_schema.columns
      where (table_schema='public' and table_name='xrpl_phase_work' and column_name='source_scan_sequence')
         or (table_schema='public' and table_name='xrpl_phase_streams' and column_name='next_scan_sequence')
    )
  )::text as state
  from state;`
}

function oneState(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('preflight state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

function normalizeSearchPath(settings) {
  const values = Array.isArray(settings) ? settings : []
  const entry = values.find((value) => String(value).startsWith('search_path='))
  return entry ? String(entry).slice('search_path='.length) : ''
}

async function runScanSequenceAudit(sourceCommit) {
  const directory = await mkdtemp(join(tmpdir(), 'xrpl-terminal-stable-guard-'))
  try {
    execFileSync(
      process.execPath,
      [
        resolve('scripts/r5-terminal-scan-sequence-readonly-audit.mjs'),
        '--source-commit',
        sourceCommit,
        '--output-dir',
        directory,
      ],
      { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return JSON.parse(await readFile(join(directory, 'scan-sequence.json'), 'utf8'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function capturePreflight(sourceCommit) {
  const guard = await loadJson(GUARD_PATH)
  if (guard.purpose !== 'xrpl-terminal-certificate-archive-stable-safety-owner-authorization') {
    fail('unexpected stable safety guard purpose')
  }
  if (guard.productionMutationAuthorized !== false || guard.productionApplied !== false) {
    fail('stable safety guard self-authorizes production')
  }
  if (guard.r5RearmAuthorized !== false || guard.mainnetEnabled !== false) {
    fail('stable safety guard runtime boundary drifted')
  }

  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const projectDigest = sha256(projectId)
  if (projectDigest !== guard.projectIdentityDigest) fail('Supabase project identity digest mismatch')

  const exactBundle = await loadExactBundle(guard)
  const functionResponse = await managementQuery(functionInspectionSql(), true)
  const functionState = oneState(functionResponse.rows)
  const scanSequence = await runScanSequenceAudit(sourceCommit)
  const expected = guard.stableSafetyGuard
  const checks = []
  const add = (name, passed, actual, wanted) => checks.push({ name, passed: Boolean(passed), actual, expected: wanted })

  add('certificateColumns.absent', Number(functionState.certificateColumnCount) === 0, Number(functionState.certificateColumnCount), 0)

  for (const [key, digest] of Object.entries(expected.functionDefinitionSha256)) {
    const row = functionState.functions?.[key]
    add(`${key}.present`, Boolean(row), Boolean(row), true)
    if (row) add(`${key}.definitionSha256`, sha256(String(row.definition)) === digest, sha256(String(row.definition)), digest)
  }

  for (const [key, digest] of Object.entries(expected.identityHelperDefinitionSha256)) {
    const row = functionState.functions?.[key]
    add(`${key}.present`, Boolean(row), Boolean(row), true)
    if (row) add(`${key}.definitionSha256`, sha256(String(row.definition)) === digest, sha256(String(row.definition)), digest)
  }

  const duplicate = functionState.functions?.duplicateCompletion
  add('duplicateCompletion.present', Boolean(duplicate), Boolean(duplicate), true)
  if (duplicate) {
    add(
      'duplicateCompletion.sourceSha256',
      sha256(String(duplicate.source)) === expected.duplicateCompletion.sourceSha256,
      sha256(String(duplicate.source)),
      expected.duplicateCompletion.sourceSha256,
    )
    add('duplicateCompletion.owner', duplicate.owner === expected.duplicateCompletion.owner, duplicate.owner, expected.duplicateCompletion.owner)
    add(
      'duplicateCompletion.securityDefiner',
      duplicate.securityDefiner === expected.duplicateCompletion.securityDefiner,
      duplicate.securityDefiner,
      expected.duplicateCompletion.securityDefiner,
    )
    add(
      'duplicateCompletion.serviceRoleDirectExecute',
      duplicate.serviceRoleDirectExecute === expected.duplicateCompletion.serviceRoleDirectExecute,
      duplicate.serviceRoleDirectExecute,
      expected.duplicateCompletion.serviceRoleDirectExecute,
    )
    add(
      'duplicateCompletion.searchPath',
      normalizeSearchPath(duplicate.settings) === expected.duplicateCompletion.searchPath,
      normalizeSearchPath(duplicate.settings),
      expected.duplicateCompletion.searchPath,
    )
  }

  add(
    'scan.transportDuplicateMessageIds',
    scanSequence.transportDuplicateMessageIds === expected.transportDuplicateMessageIdsMustRemain,
    scanSequence.transportDuplicateMessageIds,
    expected.transportDuplicateMessageIdsMustRemain,
  )
  add(
    'scan.nonzeroHistoricalSequences',
    scanSequence.scanSequenceNonzeroRows === expected.historicalNonzeroSourceScanSequencesMustRemain,
    scanSequence.scanSequenceNonzeroRows,
    expected.historicalNonzeroSourceScanSequencesMustRemain,
  )
  add(
    'scan.activeSequences',
    JSON.stringify(scanSequence.activeScanSequences) === JSON.stringify(expected.activeScanSequencesMustRemain),
    scanSequence.activeScanSequences,
    expected.activeScanSequencesMustRemain,
  )
  add(
    'scan.productiveMappingDigest',
    scanSequence.productiveMappingDigest === expected.productiveMappingDigestMustRemain,
    scanSequence.productiveMappingDigest,
    expected.productiveMappingDigestMustRemain,
  )
  add('scan.historicalMappingProven', scanSequence.historicalSequenceMappingProven === true, scanSequence.historicalSequenceMappingProven, true)
  add('scan.activeCertificateProven', scanSequence.activeSequenceCertificateProven === true, scanSequence.activeSequenceCertificateProven, true)

  const failed = checks.filter((check) => !check.passed)
  return {
    schemaVersion: 1,
    purpose: 'xrpl-terminal-certificate-archive-bounded-apply-preflight',
    sourceCommit,
    guardId: guard.guardId,
    executionCommit: guard.executionCommit,
    bundleSha256: exactBundle.digest,
    projectIdentityDigest: projectDigest,
    checks,
    eligible: failed.length === 0,
    failedCheckNames: failed.map((check) => check.name),
    volatileEvidence: {
      databaseBytes: scanSequence.databaseBytes,
      transportRows: scanSequence.transportRows,
      completedScanRows: scanSequence.completedScanRows,
      productiveScanRows: scanSequence.productiveScanRows,
      caughtUpScanRows: scanSequence.caughtUpScanRows,
      unknownScanRows: scanSequence.unknownScanRows,
    },
    productionDatabaseReadOnly: true,
    productionMutationPerformed: false,
    r5RearmAuthorized: false,
    mainnetEnabled: false,
    guard,
    bundle: exactBundle.bundle,
  }
}

const { command, options } = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

if (command === 'preflight') {
  const result = await capturePreflight(sourceCommit)
  const output = options.output
  const safeResult = { ...result }
  delete safeResult.bundle
  delete safeResult.guard
  await writeJson(output, safeResult)
  if (!result.eligible) fail(`stable safety preflight failed: ${result.failedCheckNames.join(', ')}`)
  process.stdout.write(`${JSON.stringify(safeResult)}\n`)
} else if (command === 'apply') {
  const authorization = options.authorization
  if (!authorization) fail('--authorization is required')
  const result = await capturePreflight(sourceCommit)
  if (authorization !== result.guard.command) fail('exact OWNER authorization command mismatch')
  if (!result.eligible) fail(`stable safety preflight failed: ${result.failedCheckNames.join(', ')}`)
  const response = await managementQuery(result.bundle, false)
  const evidence = {
    schemaVersion: 1,
    purpose: 'xrpl-terminal-certificate-archive-bounded-apply',
    sourceCommit,
    guardId: result.guardId,
    executionCommit: result.executionCommit,
    bundleSha256: result.bundleSha256,
    exactOwnerAuthorizationMatched: true,
    stableSafetyPreflightPassed: true,
    singleTransactionBundle: true,
    managementApiResponseRows: response.rows.length,
    productionMutationPerformed: true,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    archiveDeleteOrStopAuthorized: false,
    r5RearmAuthorized: false,
    mainnetEnabled: false,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} else {
  fail(`unsupported command: ${command ?? '<missing>'}`)
}
