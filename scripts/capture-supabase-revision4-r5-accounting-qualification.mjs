#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  PROFILE_ID,
  PROFILE_IDENTITY_DIGEST,
  qualifyRevision4AccountingEvidence,
  sha256Hex,
} from './qualify-supabase-revision4-r5-accounting.mjs'

const QUALIFICATION_KEY = 'r4f-revision4-r5-12-ledger-accounting-v1'
const PURPOSE = 'r4f-revision4-r5-accounting-qualification-evidence'
const RUN_ID = 'r5-recovery-selected-revision4-entry'

function fail(message) {
  throw new Error(`revision4 accounting capture: ${message}`)
}

function argument(argv, name) {
  const index = argv.indexOf(name)
  return index >= 0 ? (argv[index + 1] ?? null) : null
}

function exactString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a non-empty string`)
  return value
}

function positiveInteger(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`${name} must be a positive safe integer`)
  return parsed
}

function exactHash(value, name) {
  const hash = exactString(value, name).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(hash)) fail(`${name} must be lowercase SHA-256 hex`)
  return hash
}

function exactCommit(value) {
  const commit = exactString(value, 'sourceCommit').toLowerCase()
  if (!/^[a-f0-9]{40}$/u.test(commit)) fail('sourceCommit must be a 40-character commit SHA')
  return commit
}

function exactBatchId(value) {
  const batchId = exactString(value, 'expectedBatchId')
  if (!/^r5-batch-v1-r5-recovery-[a-z0-9][a-z0-9-]{7,79}-[0-9]{8}$/u.test(batchId)) {
    fail('expectedBatchId is not canonical')
  }
  return batchId
}

function exactInteger(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${name} must be a non-negative safe integer`)
  return parsed
}

function exactUtc(value, name) {
  const text = exactString(value, name)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text)) {
    fail(`${name} must be canonical millisecond UTC`)
  }
  if (!Number.isFinite(Date.parse(text))) fail(`${name} must be valid`)
  return text
}

export function buildQualificationInputFromEvidence(evidence, expected) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('database evidence must be one object')
  }
  if (
    evidence.schemaVersion !== 1
    || evidence.purpose !== PURPOSE
    || evidence.found !== true
    || evidence.qualificationKey !== QUALIFICATION_KEY
    || evidence.runId !== RUN_ID
    || evidence.batchId !== expected.expectedBatchId
    || evidence.ledgerCount !== 12
    || evidence.profileId !== PROFILE_ID
    || evidence.profileRevision !== 4
    || evidence.profileIdentityDigest !== PROFILE_IDENTITY_DIGEST
    || evidence.boundedSingletonStorage !== true
    || evidence.completionRequestBodyUnchanged !== true
    || evidence.completionResponseBodyUnchanged !== true
    || evidence.publicReaderUnchanged !== true
    || evidence.mainnetDisabled !== true
  ) {
    fail('database evidence identity or safety boundary changed')
  }

  exactUtc(evidence.completedAt, 'evidence.completedAt')
  exactUtc(evidence.capturedAt, 'evidence.capturedAt')
  if (Date.parse(evidence.capturedAt) < Date.parse(evidence.completedAt)) {
    fail('database evidence was captured before completion')
  }

  const accountingJson = exactString(evidence.accountingJson, 'evidence.accountingJson')
  const accountingJsonBytes = Buffer.byteLength(accountingJson, 'utf8')
  if (accountingJsonBytes !== exactInteger(evidence.accountingJsonBytes, 'evidence.accountingJsonBytes')) {
    fail('accountingJson byte count mismatch')
  }
  if (accountingJsonBytes < 1 || accountingJsonBytes > 16_384) {
    fail('accountingJson exceeds bounded singleton contract')
  }

  const accountingDigest = exactHash(evidence.accountingDigest, 'evidence.accountingDigest')
  if (sha256Hex(accountingJson) !== accountingDigest) {
    fail('database accountingJson bytes do not match accountingDigest')
  }
  if (accountingDigest !== expected.expectedAccountingDigest) {
    fail('database accountingDigest does not match executor response')
  }

  const finalizedEgressUpperBoundBytes = exactInteger(
    evidence.finalizedEgressUpperBoundBytes,
    'evidence.finalizedEgressUpperBoundBytes',
  )
  if (finalizedEgressUpperBoundBytes !== expected.expectedFinalizedEgressUpperBoundBytes) {
    fail('database finalized egress does not match executor response')
  }

  const startLedgerIndex = exactInteger(evidence.startLedgerIndex, 'evidence.startLedgerIndex')
  const endLedgerIndex = exactInteger(evidence.endLedgerIndex, 'evidence.endLedgerIndex')
  if (startLedgerIndex < 1 || endLedgerIndex !== startLedgerIndex + 11) {
    fail('database 12-ledger range arithmetic changed')
  }

  return {
    sessionId: evidence.runId,
    tickId: evidence.batchId,
    ledgerCount: 12,
    status: 'completed',
    profileRevision: 4,
    profileIdentityDigest: PROFILE_IDENTITY_DIGEST,
    finalizedEgressUpperBoundBytes,
    accountingJson,
    accountingDigest,
    workflowRunId: expected.workflowRunId,
    workflowRunAttempt: expected.workflowRunAttempt,
    sourceCommit: expected.sourceCommit,
  }
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  fail('Management API response does not contain rows')
}

function valueFromRows(rows) {
  if (rows.length !== 1) fail(`qualification evidence query returned ${rows.length} rows`)
  let value = rows[0]?.evidence
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      fail('qualification evidence row is not valid JSON')
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('qualification evidence row is missing')
  }
  return value
}

async function readEvidence(projectRef, accessToken) {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      query: 'select public.xrpl_read_r5_revision4_accounting_qualification_evidence() as evidence',
      parameters: [],
      read_only: true,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    fail(`Management API returned non-JSON (${response.status})`)
  }
  if (!response.ok) {
    fail(`Management API read failed (${response.status}): ${JSON.stringify(body).slice(0, 1000)}`)
  }
  return valueFromRows(rowsFromResponse(body))
}

export async function captureQualification(options) {
  const projectRef = exactString(options.projectRef, 'projectRef')
  if (!/^[a-z]{20}$/u.test(projectRef)) fail('projectRef must be an exact Supabase project ref')
  const accessToken = exactString(options.accessToken, 'accessToken')
  if (accessToken.length < 20) fail('accessToken is unavailable')

  const expected = {
    expectedBatchId: exactBatchId(options.expectedBatchId),
    expectedAccountingDigest: exactHash(options.expectedAccountingDigest, 'expectedAccountingDigest'),
    expectedFinalizedEgressUpperBoundBytes: exactInteger(
      options.expectedFinalizedEgressUpperBoundBytes,
      'expectedFinalizedEgressUpperBoundBytes',
    ),
    workflowRunId: positiveInteger(options.workflowRunId, 'workflowRunId'),
    workflowRunAttempt: positiveInteger(options.workflowRunAttempt, 'workflowRunAttempt'),
    sourceCommit: exactCommit(options.sourceCommit),
  }

  const evidence = await readEvidence(projectRef, accessToken)
  const qualificationInput = buildQualificationInputFromEvidence(evidence, expected)
  const qualification = qualifyRevision4AccountingEvidence(qualificationInput)
  return {
    schemaVersion: 1,
    purpose: 'r4f-revision4-r5-accounting-qualification-capture',
    projectIdentityDigest: sha256Hex(projectRef),
    providerEndpoint: 'supabase-management-api-database-query-read-only',
    source: {
      workflowRunId: expected.workflowRunId,
      workflowRunAttempt: expected.workflowRunAttempt,
      sourceCommit: expected.sourceCommit,
    },
    executorParity: {
      batchId: expected.expectedBatchId,
      accountingDigest: expected.expectedAccountingDigest,
      finalizedEgressUpperBoundBytes: expected.expectedFinalizedEgressUpperBoundBytes,
    },
    databaseEvidence: evidence,
    qualificationInput,
    qualification,
    safety: {
      managementApiReadOnly: true,
      databaseMutationIssued: false,
      recoveryMutationIssuedByCapture: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
    },
  }
}

async function main(argv) {
  const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  const expectedBatchId = argument(argv, '--expected-batch-id')
  const expectedAccountingDigest = argument(argv, '--expected-accounting-digest')
  const expectedFinalizedEgressUpperBoundBytes = argument(argv, '--expected-finalized-egress')
  const workflowRunId = argument(argv, '--workflow-run-id')
  const workflowRunAttempt = argument(argv, '--workflow-run-attempt')
  const sourceCommit = argument(argv, '--source-commit')
  const output = argument(argv, '--output')
  if (!output) fail('--output is required')

  const capture = await captureQualification({
    projectRef,
    accessToken,
    expectedBatchId,
    expectedAccountingDigest,
    expectedFinalizedEgressUpperBoundBytes,
    workflowRunId,
    workflowRunAttempt,
    sourceCommit,
  })
  const outputPath = resolve(output)
  const slash = outputPath.lastIndexOf('/')
  if (slash > 0) await mkdir(outputPath.slice(0, slash), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({
    batchId: capture.executorParity.batchId,
    accountingDigest: capture.executorParity.accountingDigest,
    rollingBillableEgressUpperBoundBytes:
      capture.qualification.rollingBillableEgressUpperBoundBytes,
    perLedgerBillableEgressUpperBoundBytes:
      capture.qualification.perLedgerBillableEgressUpperBoundBytes,
    pass: capture.qualification.pass,
    qualificationDigest: capture.qualification.qualificationDigest,
    output: outputPath,
  })}\n`)
  return capture.qualification.pass ? 0 : 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv).then(
    (code) => { process.exitCode = code },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
