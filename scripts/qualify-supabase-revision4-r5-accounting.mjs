#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PROFILE_ID = 'supabase_free_postgres_pgcron_edge'
export const PROFILE_REVISION = 4
export const PROFILE_IDENTITY_DIGEST =
  '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
export const REQUIRED_LEDGER_COUNT = 12
export const MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER = 4_581
export const MAXIMUM_BILLABLE_EGRESS_BYTES =
  REQUIRED_LEDGER_COUNT * MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER

const SUPPORTED_BOUNDARIES = new Set([
  'invoker_to_edge_request',
  'edge_to_invoker_response',
  'edge_to_xrpl_request',
  'xrpl_to_edge_response',
  'edge_to_database_request',
  'database_to_edge_response',
  'edge_to_edge_request',
  'edge_to_edge_response',
])
const BILLABLE_BOUNDARIES = new Set([
  'edge_to_invoker_response',
  'edge_to_xrpl_request',
  'edge_to_database_request',
  'database_to_edge_response',
  'edge_to_edge_request',
  'edge_to_edge_response',
])

function fail(message) {
  throw new Error(`revision4 accounting qualification: ${message}`)
}

function exactString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a non-empty string`)
  return value
}

function exactInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative safe integer`)
  return value
}

function positiveInteger(value, name) {
  const integer = exactInteger(value, name)
  if (integer < 1) fail(`${name} must be positive`)
  return integer
}

function exactBoolean(value, name) {
  if (value !== true && value !== false) fail(`${name} must be boolean`)
  return value
}

function safeAdd(left, right, name) {
  exactInteger(left, `${name}.left`)
  exactInteger(right, `${name}.right`)
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} exceeds the safe integer range`)
  return value
}

function exactObservedAt(value) {
  const observedAt = exactString(value, 'accounting.observedAt')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(observedAt)) {
    fail('accounting.observedAt must be canonical UTC')
  }
  if (!Number.isFinite(Date.parse(observedAt))) fail('accounting.observedAt must be valid')
  return observedAt
}

function exactSourceCommit(value) {
  const sourceCommit = exactString(value, 'sourceCommit').toLowerCase()
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) fail('sourceCommit must be a 40-character commit SHA')
  return sourceCommit
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortCanonical(value[key])]),
    )
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(sortCanonical(value))
}

export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function parseAccountingJson(input) {
  const accountingJson = exactString(input.accountingJson, 'accountingJson')
  let accounting
  try {
    accounting = JSON.parse(accountingJson)
  } catch {
    fail('accountingJson is not valid JSON')
  }
  if (!accounting || typeof accounting !== 'object' || Array.isArray(accounting)) {
    fail('accountingJson must contain one accounting object')
  }
  return { accountingJson, accounting }
}

function verifyChecks(checks) {
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) fail('accounting.checks missing')
  const requiredTrue = [
    'exactProfileIdentityBound',
    'everyObservationDirectionBoundByContract',
    'inboundBytesRemainInMemoryTransport',
    'accountingPreparedBeforeAtomicCompletion',
    'accountingMustCommitAtomicallyWithWork',
    'publicReaderUnchanged',
    'mainnetDisabled',
  ]
  const requiredFalse = [
    'blanketAllDirectionMultiplierUsed',
    'stabilizationAuthorized',
    'soakAuthorized',
  ]
  for (const key of requiredTrue) {
    if (exactBoolean(checks[key], `accounting.checks.${key}`) !== true) fail(`accounting.checks.${key} must be true`)
  }
  for (const key of requiredFalse) {
    if (exactBoolean(checks[key], `accounting.checks.${key}`) !== false) fail(`accounting.checks.${key} must be false`)
  }
}

function validateObservations(observations) {
  if (!Array.isArray(observations) || observations.length === 0) fail('accounting.observations missing')
  const operationIds = new Set()
  return observations.map((observation, index) => {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
      fail(`accounting.observations[${index}] invalid`)
    }
    if (observation.schemaVersion !== 1) fail(`observations[${index}].schemaVersion must be 1`)
    if (observation.sequence !== index) fail('observation sequence must be contiguous from zero')
    const operationId = exactString(observation.operationId, `observations[${index}].operationId`)
    if (operationIds.has(operationId)) fail(`operationId is duplicated: ${operationId}`)
    operationIds.add(operationId)
    const boundaryId = exactString(observation.boundaryId, `observations[${index}].boundaryId`)
    if (!SUPPORTED_BOUNDARIES.has(boundaryId)) fail(`observations[${index}].boundaryId is unsupported`)
    return {
      schemaVersion: 1,
      sequence: index,
      operationId,
      boundaryId,
      bodyBytes: exactInteger(observation.bodyBytes, `observations[${index}].bodyBytes`),
      framingReserveBytes: exactInteger(
        observation.framingReserveBytes,
        `observations[${index}].framingReserveBytes`,
      ),
    }
  })
}

function recomputeDirectionalSummary(observations) {
  let rollingBillableEgressUpperBoundBytes = 0
  let memoryTransportBytes = 0
  const byBoundary = observations.map((observation) => {
    const totalBytes = safeAdd(
      observation.bodyBytes,
      observation.framingReserveBytes,
      `boundary.${observation.boundaryId}.totalBytes`,
    )
    const rollingBillableEgressBytes = BILLABLE_BOUNDARIES.has(observation.boundaryId)
      ? totalBytes
      : 0
    rollingBillableEgressUpperBoundBytes = safeAdd(
      rollingBillableEgressUpperBoundBytes,
      rollingBillableEgressBytes,
      'directionalSummary.rollingBillableEgressUpperBoundBytes',
    )
    memoryTransportBytes = safeAdd(
      memoryTransportBytes,
      totalBytes,
      'directionalSummary.memoryTransportBytes',
    )
    return {
      boundaryId: observation.boundaryId,
      totalBytes,
      rollingBillableEgressBytes,
      memoryTransportBytes: totalBytes,
    }
  })
  return { rollingBillableEgressUpperBoundBytes, memoryTransportBytes, byBoundary }
}

function verifyMemorySupplemental(memorySupplemental) {
  if (!memorySupplemental || typeof memorySupplemental !== 'object' || Array.isArray(memorySupplemental)) {
    fail('accounting.memorySupplemental missing')
  }
  return {
    canonicalJsonBytes: exactInteger(memorySupplemental.canonicalJsonBytes, 'memorySupplemental.canonicalJsonBytes'),
    payloadBytes: exactInteger(memorySupplemental.payloadBytes, 'memorySupplemental.payloadBytes'),
    normalizedObjectOverheadBytes: exactInteger(
      memorySupplemental.normalizedObjectOverheadBytes,
      'memorySupplemental.normalizedObjectOverheadBytes',
    ),
    allocatorReserveBytes: exactInteger(memorySupplemental.allocatorReserveBytes, 'memorySupplemental.allocatorReserveBytes'),
  }
}

export function qualifyRevision4AccountingEvidence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input must be one object')

  const ledgerCount = exactInteger(input.ledgerCount, 'ledgerCount')
  if (ledgerCount !== REQUIRED_LEDGER_COUNT) {
    fail(`ledgerCount must be exactly ${REQUIRED_LEDGER_COUNT}; received ${ledgerCount}`)
  }
  if (input.status !== 'completed') fail('status must be completed')
  if (input.profileRevision !== PROFILE_REVISION) fail(`profileRevision must be ${PROFILE_REVISION}`)
  if (input.profileIdentityDigest !== PROFILE_IDENTITY_DIGEST) fail('wrapper profileIdentityDigest mismatch')

  const { accountingJson, accounting } = parseAccountingJson(input)
  const accountingDigest = exactString(input.accountingDigest, 'accountingDigest').toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(accountingDigest)) fail('accountingDigest must be lowercase SHA-256 hex')
  const calculatedAccountingDigest = sha256Hex(accountingJson)
  if (calculatedAccountingDigest !== accountingDigest) fail('accountingDigest does not match accountingJson bytes')

  if (accounting.schemaVersion !== 1) fail('accounting.schemaVersion must be 1')
  if (accounting.profileId !== PROFILE_ID) fail('accounting.profileId mismatch')
  if (accounting.profileRevision !== PROFILE_REVISION) fail(`accounting.profileRevision must be ${PROFILE_REVISION}`)
  if (accounting.profileIdentityDigest !== PROFILE_IDENTITY_DIGEST) fail('accounting profileIdentityDigest mismatch')
  if (accounting.disposition !== 'runtime_precommit_completed') {
    fail('accounting.disposition must be runtime_precommit_completed')
  }
  verifyChecks(accounting.checks)

  const observations = validateObservations(accounting.observations)
  const recomputedDirectionalSummary = recomputeDirectionalSummary(observations)
  if (canonicalJson(accounting.directionalSummary) !== canonicalJson(recomputedDirectionalSummary)) {
    fail('accounting.directionalSummary does not match observations')
  }

  const unexplainedDirectionalDeltaReserveBytes = exactInteger(
    accounting.unexplainedDirectionalDeltaReserveBytes,
    'accounting.unexplainedDirectionalDeltaReserveBytes',
  )
  const recomputedRollingBillableEgressUpperBoundBytes = safeAdd(
    recomputedDirectionalSummary.rollingBillableEgressUpperBoundBytes,
    unexplainedDirectionalDeltaReserveBytes,
    'accounting.rollingBillableEgressUpperBoundBytes',
  )
  const rollingBillableEgressUpperBoundBytes = exactInteger(
    accounting.rollingBillableEgressUpperBoundBytes,
    'accounting.rollingBillableEgressUpperBoundBytes',
  )
  if (rollingBillableEgressUpperBoundBytes !== recomputedRollingBillableEgressUpperBoundBytes) {
    fail('accounting rolling upper bound does not match observations plus unexplained reserve')
  }

  const memorySupplemental = verifyMemorySupplemental(accounting.memorySupplemental)
  const recomputedMemoryTransportUpperBoundBytes = [
    memorySupplemental.canonicalJsonBytes,
    memorySupplemental.payloadBytes,
    memorySupplemental.normalizedObjectOverheadBytes,
    memorySupplemental.allocatorReserveBytes,
  ].reduce(
    (total, value) => safeAdd(total, value, 'accounting.memoryTransportUpperBoundBytes'),
    recomputedDirectionalSummary.memoryTransportBytes,
  )
  if (
    exactInteger(accounting.memoryTransportUpperBoundBytes, 'accounting.memoryTransportUpperBoundBytes')
    !== recomputedMemoryTransportUpperBoundBytes
  ) {
    fail('accounting memory transport upper bound does not match observations plus supplements')
  }

  const perLedgerBillableEgressUpperBoundBytes = rollingBillableEgressUpperBoundBytes / ledgerCount
  const maximumBillableEgressBytes = ledgerCount * MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER
  const remainingBillableEgressBytes = maximumBillableEgressBytes - rollingBillableEgressUpperBoundBytes
  const pass = rollingBillableEgressUpperBoundBytes <= maximumBillableEgressBytes

  const finalizedEgressUpperBoundBytes = exactInteger(
    input.finalizedEgressUpperBoundBytes,
    'finalizedEgressUpperBoundBytes',
  )
  if (finalizedEgressUpperBoundBytes !== rollingBillableEgressUpperBoundBytes) {
    fail('finalizedEgressUpperBoundBytes does not match accounting rolling upper bound')
  }

  const workflowRunId = positiveInteger(input.workflowRunId, 'workflowRunId')
  const workflowRunAttempt = positiveInteger(input.workflowRunAttempt, 'workflowRunAttempt')
  const sourceCommit = exactSourceCommit(input.sourceCommit)

  const resultWithoutDigest = {
    schemaVersion: 1,
    qualification: 'supabase-revision4-r5-12-ledger-billable-egress',
    observationId: exactString(accounting.observationId, 'accounting.observationId'),
    attemptId: exactString(accounting.attemptId, 'accounting.attemptId'),
    observedAt: exactObservedAt(accounting.observedAt),
    sessionId: exactString(input.sessionId, 'sessionId'),
    tickId: exactString(input.tickId, 'tickId'),
    ledgerCount,
    profileId: PROFILE_ID,
    profileRevision: PROFILE_REVISION,
    profileIdentityDigest: PROFILE_IDENTITY_DIGEST,
    accountingDigest,
    calculatedAccountingDigest,
    finalizedEgressUpperBoundBytes,
    rollingBillableEgressUpperBoundBytes,
    maximumBillableEgressBytesPerLedger: MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER,
    maximumBillableEgressBytes,
    perLedgerBillableEgressUpperBoundBytes,
    remainingBillableEgressBytes,
    usageFraction: rollingBillableEgressUpperBoundBytes / maximumBillableEgressBytes,
    pass,
    directionalSummary: recomputedDirectionalSummary,
    unexplainedDirectionalDeltaReserveBytes,
    observations,
    checks: accounting.checks,
    source: {
      workflowRunId,
      workflowRunAttempt,
      sourceCommit,
    },
  }

  const qualificationJson = canonicalJson(resultWithoutDigest)
  return {
    ...resultWithoutDigest,
    qualificationDigest: sha256Hex(qualificationJson),
  }
}

function main(argv) {
  const args = argv.slice(2)
  if (args.length < 1 || args.length > 2) {
    console.error('usage: node scripts/qualify-supabase-revision4-r5-accounting.mjs <input.json> [output.json]')
    return 64
  }
  const inputPath = resolve(args[0])
  const outputPath = args[1] ? resolve(args[1]) : null
  let input
  try {
    input = JSON.parse(readFileSync(inputPath, 'utf8'))
    const result = qualifyRevision4AccountingEvidence(input)
    const output = `${JSON.stringify(result, null, 2)}\n`
    if (outputPath) writeFileSync(outputPath, output, 'utf8')
    else process.stdout.write(output)
    return result.pass ? 0 : 2
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv)
}
