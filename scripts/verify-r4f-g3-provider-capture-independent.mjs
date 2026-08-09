import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const EXPECTED_PROFILE_ID = 'supabase_free_postgres_pgcron_edge'
const EXPECTED_PROFILE_REVISION = 4
const EXPECTED_PROFILE_DIGEST =
  '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const EXPECTED_PROJECT_DIGEST =
  '81378864f4d6650a60a2c09a95629a18780d49fc23836e0f6a024b70f13f88a8'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COMMIT_PATTERN = /^[a-f0-9]{40}$/
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const CAPTURE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/
const DISPLAY_UNIT_BYTES = Object.freeze({
  bytes: 1n,
  kB: 1_000n,
  MB: 1_000_000n,
  GB: 1_000_000_000n,
  KiB: 1_024n,
  MiB: 1_048_576n,
  GiB: 1_073_741_824n,
})
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function fail(name, detail) {
  return { name, passed: false, detail }
}

function pass(name, detail = 'ok') {
  return { name, passed: true, detail }
}

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum
}

function validDigest(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value) && value !== '0'.repeat(64)
}

function canonicalUtc(value) {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value)) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : null
}

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new Error('denominator must be positive')
  if (numerator <= 0n) return 0n
  return (numerator + denominator - 1n) / denominator
}

function toSafeNumber(value) {
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new Error('byte interval exceeds safe integer range')
  }
  return Number(value)
}

function parseDisplay(reading) {
  if (!reading || typeof reading !== 'object') {
    throw new Error('display reading must be an object')
  }
  const decimalPlaces = reading.decimalPlaces
  if (!safeInteger(decimalPlaces) || decimalPlaces > 9) {
    throw new Error('decimalPlaces must be an integer from 0 through 9')
  }
  const unitBytes = DISPLAY_UNIT_BYTES[reading.unit]
  if (!unitBytes) throw new Error('unsupported display unit')
  if (!['exact', 'nearest_half_up', 'truncate_down'].includes(reading.roundingRule)) {
    throw new Error('unsupported display rounding rule')
  }
  const pattern = decimalPlaces === 0 ? /^\d+$/ : new RegExp(`^\\d+\\.\\d{${decimalPlaces}}$`)
  if (typeof reading.displayedValue !== 'string' || !pattern.test(reading.displayedValue)) {
    throw new Error('displayedValue does not match decimalPlaces')
  }
  const [whole, fraction = ''] = reading.displayedValue.split('.')
  const scale = 10n ** BigInt(decimalPlaces)
  const scaled = BigInt(whole) * scale + BigInt(fraction || '0')

  let lower
  let upper
  if (reading.roundingRule === 'exact') {
    const numerator = scaled * unitBytes
    if (numerator % scale !== 0n) throw new Error('exact value does not resolve to whole bytes')
    lower = numerator / scale
    upper = lower
  } else if (reading.roundingRule === 'nearest_half_up') {
    const denominator = 2n * scale
    lower = ceilDiv((2n * scaled - 1n) * unitBytes, denominator)
    upper = ceilDiv((2n * scaled + 1n) * unitBytes, denominator) - 1n
  } else {
    lower = ceilDiv(scaled * unitBytes, scale)
    upper = ceilDiv((scaled + 1n) * unitBytes, scale) - 1n
  }
  if (upper < lower) throw new Error('empty display interval')
  return { lowerBoundBytes: toSafeNumber(lower), upperBoundBytes: toSafeNumber(upper) }
}

function checkArtifacts(input) {
  const checks = []
  const pairs = [
    ['before', input.before?.sourceArtifact, input.before?.sourceArtifactDigest],
    ['after', input.after?.sourceArtifact, input.after?.sourceArtifactDigest],
    ['authorization', input.authorization?.evidenceArtifact, input.authorization?.evidenceDigest],
  ]
  for (const [name, artifact, digest] of pairs) {
    checks.push(
      typeof artifact === 'string' && artifact.trim().length > 0 && validDigest(digest)
        ? pass(`${name}_artifact_bound`)
        : fail(`${name}_artifact_bound`, 'artifact path and non-placeholder SHA-256 are required'),
    )
  }
  const artifacts = input.concurrentTraffic?.evidenceArtifacts
  const digests = input.concurrentTraffic?.evidenceArtifactDigests
  const trafficArtifactsValid =
    Array.isArray(artifacts) &&
    artifacts.length > 0 &&
    artifacts.every((value) => typeof value === 'string' && value.trim().length > 0) &&
    Array.isArray(digests) &&
    digests.length === artifacts.length &&
    digests.every(validDigest)
  checks.push(
    trafficArtifactsValid
      ? pass('concurrent_traffic_artifacts_bound')
      : fail('concurrent_traffic_artifacts_bound', 'one digest-bound traffic artifact is required'),
  )
  return checks
}

export function auditR4fG3ProviderCaptureIndependent(input) {
  const checks = []

  const identityOk =
    input?.schemaVersion === 1 &&
    input?.profileId === EXPECTED_PROFILE_ID &&
    input?.profileRevision === EXPECTED_PROFILE_REVISION &&
    input?.profileIdentityDigest === EXPECTED_PROFILE_DIGEST
  checks.push(identityOk ? pass('revision4_identity') : fail('revision4_identity', 'profile identity mismatch'))

  const captureIdOk = typeof input?.captureId === 'string' && CAPTURE_ID_PATTERN.test(input.captureId)
  checks.push(captureIdOk ? pass('capture_id') : fail('capture_id', 'captureId is invalid'))

  const authorizedCapture =
    input?.captureState === 'authorized_dashboard_capture' &&
    input?.authorization?.issueNumber === 1261 &&
    safeInteger(input?.authorization?.commentId, 1) &&
    input?.authorization?.actor === 'badjoke-lab' &&
    input?.authorization?.scope === 'r4f_g3_dashboard_capture' &&
    COMMIT_PATTERN.test(input?.authorization?.sourceCommit ?? '') &&
    input?.authorization?.sourceCommit === input?.application?.sourceCommit
  checks.push(
    authorizedCapture
      ? pass('authorized_capture')
      : fail('authorized_capture', 'exact pre-authorized dashboard capture is required'),
  )

  const projectOk =
    input?.projectIdentityDigest === EXPECTED_PROJECT_DIGEST &&
    input?.providerSurface?.source === 'organization_usage_page' &&
    input?.providerSurface?.metric === 'total_egress' &&
    input?.providerSurface?.projectFilterApplied === true &&
    input?.providerSurface?.selectedProjectIdentityDigest === EXPECTED_PROJECT_DIGEST &&
    input?.providerSurface?.billingPeriodFilterApplied === true &&
    input?.providerSurface?.cachedEgressIncluded === true
  checks.push(projectOk ? pass('provider_surface') : fail('provider_surface', 'project-filtered total egress surface mismatch'))

  const periodStart = canonicalUtc(input?.billingPeriodStart)
  const periodEnd = canonicalUtc(input?.billingPeriodEnd)
  const authAt = canonicalUtc(input?.authorization?.createdAt)
  const beforeAt = canonicalUtc(input?.before?.capturedAt)
  const afterAt = canonicalUtc(input?.after?.capturedAt)
  const timingOk =
    periodStart !== null &&
    periodEnd !== null &&
    authAt !== null &&
    beforeAt !== null &&
    afterAt !== null &&
    periodStart < periodEnd &&
    authAt < beforeAt &&
    beforeAt >= periodStart &&
    beforeAt < periodEnd &&
    afterAt > beforeAt &&
    afterAt <= periodEnd
  checks.push(timingOk ? pass('capture_timing') : fail('capture_timing', 'authorization/BEFORE/AFTER ordering or billing period is invalid'))

  let beforeInterval = null
  let afterInterval = null
  try {
    beforeInterval = parseDisplay(input?.before)
    afterInterval = parseDisplay(input?.after)
    checks.push(pass('display_intervals'))
  } catch (error) {
    checks.push(fail('display_intervals', error instanceof Error ? error.message : String(error)))
  }

  const beforeInvocations = input?.providerUsageFreshness?.beforeEdgeFunctionInvocations
  const afterInvocations = input?.providerUsageFreshness?.afterEdgeFunctionInvocations
  const invocationFresh =
    safeInteger(beforeInvocations) &&
    safeInteger(afterInvocations) &&
    afterInvocations - beforeInvocations >= 1
  checks.push(
    invocationFresh
      ? pass('provider_usage_fresh', `invocation_delta=${afterInvocations - beforeInvocations}`)
      : fail('provider_usage_fresh', 'AFTER invocations must exceed BEFORE by at least one'),
  )

  const applicationOk =
    safeInteger(input?.application?.rollingBillableEgressUpperBoundBytes) &&
    safeInteger(input?.application?.retainedUnexplainedDeltaReserveBytes) &&
    validDigest(input?.application?.accountingDigest) &&
    COMMIT_PATTERN.test(input?.application?.sourceCommit ?? '') &&
    safeInteger(input?.application?.sourceRunId, 1)
  checks.push(applicationOk ? pass('application_evidence') : fail('application_evidence', 'application accounting evidence is invalid'))

  const trafficOk = input?.concurrentTraffic?.excluded === true
  checks.push(
    trafficOk
      ? pass('concurrent_traffic_excluded')
      : fail('concurrent_traffic_excluded', 'concurrent provider traffic was not excluded'),
  )
  checks.push(...checkArtifacts(input ?? {}))

  const safety = input?.safety
  const safetyOk =
    safety?.providerMutationPerformed === false &&
    safety?.productionMigrationPerformed === false &&
    safety?.recoveryMutationCommitted === false &&
    safety?.publicReaderUnchanged === true &&
    safety?.mainnetDisabled === true &&
    safety?.stabilizationAuthorized === false &&
    safety?.soakAuthorized === false
  checks.push(safetyOk ? pass('safety_boundary') : fail('safety_boundary', 'G3 safety boundary was crossed'))

  let reconciliation = null
  if (beforeInterval && afterInterval && applicationOk) {
    const counterResetOrScopeChange = afterInterval.upperBoundBytes < beforeInterval.lowerBoundBytes
    const providerDeltaLowerBoundBytes = counterResetOrScopeChange
      ? 0
      : Math.max(0, afterInterval.lowerBoundBytes - beforeInterval.upperBoundBytes)
    const providerDeltaUpperBoundBytes = counterResetOrScopeChange
      ? 0
      : Math.max(0, afterInterval.upperBoundBytes - beforeInterval.lowerBoundBytes)
    const applicationUpper = input.application.rollingBillableEgressUpperBoundBytes
    const retainedReserve = input.application.retainedUnexplainedDeltaReserveBytes
    const newlyRequiredReserve = Math.max(0, providerDeltaUpperBoundBytes - applicationUpper)
    const selectedReserve = Math.max(retainedReserve, newlyRequiredReserve)
    const coveredUpperBound = applicationUpper + selectedReserve
    const safeSum = Number.isSafeInteger(coveredUpperBound)
    const upperCovered = safeSum && coveredUpperBound >= providerDeltaUpperBoundBytes
    reconciliation = {
      providerDeltaLowerBoundBytes,
      providerDeltaUpperBoundBytes,
      counterResetOrScopeChange,
      newlyRequiredUnexplainedDeltaReserveBytes: newlyRequiredReserve,
      selectedUnexplainedDeltaReserveBytes: selectedReserve,
      applicationCoveredUpperBoundBytes: safeSum ? coveredUpperBound : null,
      intervalUpperBoundCovered: upperCovered,
    }
    checks.push(
      !counterResetOrScopeChange
        ? pass('no_counter_reset_or_scope_change')
        : fail('no_counter_reset_or_scope_change', 'AFTER interval is below BEFORE interval'),
    )
    checks.push(
      upperCovered
        ? pass('provider_delta_upper_bound_covered')
        : fail('provider_delta_upper_bound_covered', 'application upper bound plus reserve does not cover provider interval'),
    )
  } else {
    checks.push(fail('no_counter_reset_or_scope_change', 'display/application evidence unavailable'))
    checks.push(fail('provider_delta_upper_bound_covered', 'display/application evidence unavailable'))
  }

  const failedChecks = checks.filter((check) => !check.passed)
  return {
    schemaVersion: 1,
    verifier: 'r4f_g3_provider_capture_independent_v1',
    implementationDependency: 'none_on_production_reconciliation_code',
    expectedProfileId: EXPECTED_PROFILE_ID,
    expectedProfileRevision: EXPECTED_PROFILE_REVISION,
    expectedProfileIdentityDigest: EXPECTED_PROFILE_DIGEST,
    expectedProjectIdentityDigest: EXPECTED_PROJECT_DIGEST,
    captureId: typeof input?.captureId === 'string' ? input.captureId : null,
    reconciliation,
    checks,
    failedChecks: failedChecks.map(({ name, detail }) => ({ name, detail })),
    auditQualified: failedChecks.length === 0,
    profileSelected: false,
    r5Authorized: false,
  }
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function main() {
  const inputPath = argument('--input')
  const outputPath = argument('--output')
  const requireQualified = process.argv.includes('--require-qualified')
  if (!inputPath || !outputPath) {
    throw new Error('usage: verify-r4f-g3-provider-capture-independent --input <json> --output <json> [--require-qualified]')
  }
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  const result = auditR4fG3ProviderCaptureIndependent(input)
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(
    `${JSON.stringify({ verifier: result.verifier, auditQualified: result.auditQualified, failedChecks: result.failedChecks })}\n`,
  )
  if (requireQualified && !result.auditQualified) process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
