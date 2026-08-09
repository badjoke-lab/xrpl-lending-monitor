import {
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'
import {
  reconcileSupabaseRevision4ProviderInterval,
  type SupabaseRevision4ProviderReconciliationResult,
} from './supabase-revision4-provider-reconciliation'

export type SupabaseRevision4ProviderDisplayUnit =
  | 'bytes'
  | 'kB'
  | 'MB'
  | 'GB'
  | 'KiB'
  | 'MiB'
  | 'GiB'

export type SupabaseRevision4ProviderDisplayRoundingRule =
  | 'exact'
  | 'nearest_half_up'
  | 'truncate_down'

export interface SupabaseRevision4ProviderDisplayReading {
  displayedValue: string
  unit: SupabaseRevision4ProviderDisplayUnit
  decimalPlaces: number
  roundingRule: SupabaseRevision4ProviderDisplayRoundingRule
  capturedAt: string
  sourceArtifact: string
  sourceArtifactDigest: string
}

export interface SupabaseRevision4ProviderCaptureInput {
  schemaVersion: 1
  profileId: typeof SUPABASE_REVISION4_PROFILE.profileId
  profileRevision: typeof SUPABASE_REVISION4_PROFILE.revision
  profileIdentityDigest: typeof SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  captureState: 'synthetic_test' | 'authorized_dashboard_capture'
  captureId: string
  authorization: {
    issueNumber: 1261
    commentId: number | null
    actor: 'badjoke-lab'
    scope: 'r4f_g3_dashboard_capture'
    sourceCommit: string
    createdAt: string
    evidenceArtifact: string
    evidenceDigest: string
  }
  projectIdentityDigest: string
  providerSurface: {
    source: 'organization_usage_page'
    metric: 'total_egress'
    projectFilterApplied: boolean
    selectedProjectIdentityDigest: string
    billingPeriodFilterApplied: boolean
    cachedEgressIncluded: true
  }
  billingPeriodStart: string
  billingPeriodEnd: string
  before: SupabaseRevision4ProviderDisplayReading
  after: SupabaseRevision4ProviderDisplayReading
  providerUsageFreshness: {
    beforeEdgeFunctionInvocations: number
    afterEdgeFunctionInvocations: number
  }
  application: {
    rollingBillableEgressUpperBoundBytes: number
    retainedUnexplainedDeltaReserveBytes: number
    accountingDigest: string
    sourceCommit: string
    sourceRunId: number
  }
  concurrentTraffic: {
    excluded: boolean
    evidenceArtifacts: string[]
    evidenceArtifactDigests: string[]
  }
  providerCapabilities: {
    managementApiEgressBytesAvailable: boolean
    dashboardPatAuthorized: boolean
    dashboardExactByteExportAvailable: boolean
    logsResponseBytesAvailable: boolean
  }
  safety: {
    providerMutationPerformed: false
    productionMigrationPerformed: false
    recoveryMutationCommitted: false
    publicReaderUnchanged: true
    mainnetDisabled: true
    stabilizationAuthorized: false
    soakAuthorized: false
  }
}

export interface SupabaseRevision4ProviderCaptureEvidence {
  schemaVersion: 1
  profileId: typeof SUPABASE_REVISION4_PROFILE.profileId
  profileRevision: typeof SUPABASE_REVISION4_PROFILE.revision
  profileIdentityDigest: typeof SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  captureState: SupabaseRevision4ProviderCaptureInput['captureState']
  captureId: string
  projectIdentityDigest: string
  providerSurface: SupabaseRevision4ProviderCaptureInput['providerSurface']
  providerSurfaceVerified: boolean
  billingPeriodStart: string
  billingPeriodEnd: string
  before: SupabaseRevision4ProviderDisplayReading & {
    lowerBoundBytes: number
    upperBoundBytes: number
  }
  after: SupabaseRevision4ProviderDisplayReading & {
    lowerBoundBytes: number
    upperBoundBytes: number
  }
  providerUsageFreshness: SupabaseRevision4ProviderCaptureInput['providerUsageFreshness'] & {
    invocationDelta: number
    verified: boolean
  }
  application: SupabaseRevision4ProviderCaptureInput['application']
  concurrentTraffic: SupabaseRevision4ProviderCaptureInput['concurrentTraffic']
  authorizationVerified: boolean
  authorizationPrecedesBefore: true
  displayIntervalsVerified: true
  sameProjectIdentity: true
  sameBillingPeriod: true
  reconciliation: SupabaseRevision4ProviderReconciliationResult
  g3Qualified: boolean
  profileSelected: false
  r5Authorized: false
}

const DISPLAY_UNIT_BYTES: Record<SupabaseRevision4ProviderDisplayUnit, bigint> = {
  bytes: 1n,
  kB: 1_000n,
  MB: 1_000_000n,
  GB: 1_000_000_000n,
  KiB: 1_024n,
  MiB: 1_048_576n,
  GiB: 1_073_741_824n,
}

const CAPTURE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COMMIT_PATTERN = /^[a-f0-9]{40}$/
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const SECRET_KEY_PATTERN =
  /(?:password|private[_-]?key|service[_-]?role|access[_-]?token|refresh[_-]?token|api[_-]?key|session[_-]?cookie|authorization[_-]?bearer)/iu
const SECRET_VALUE_PATTERN =
  /(?:sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,}|postgres(?:ql)?:\/\/[^\s]+|Bearer\s+[A-Za-z0-9._-]{12,})/u

function safeInteger(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer of at least ${minimum}`)
  }
  return value
}

function canonicalUtc(value: string, name: string): number {
  if (!CANONICAL_UTC_PATTERN.test(value)) {
    throw new Error(`${name} must be canonical UTC`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${name} must be a valid timestamp`)
  }
  return milliseconds
}

function nonEmptyArtifacts(values: readonly string[], name: string): void {
  if (
    values.length < 1 ||
    values.some((value) => typeof value !== 'string' || value.trim().length === 0)
  ) {
    throw new Error(`${name} must contain at least one non-empty artifact`)
  }
}

function validDigest(value: string): boolean {
  return SHA256_PATTERN.test(value) && value !== '0'.repeat(64)
}

function artifactDigests(
  values: readonly string[],
  expectedCount: number,
  name: string,
): void {
  if (values.length !== expectedCount || values.some((value) => !validDigest(value))) {
    throw new Error(`${name} must contain one non-placeholder SHA-256 per artifact`)
  }
}

function containsSecret(value: unknown, key = ''): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return true
  if (typeof value === 'string') return SECRET_VALUE_PATTERN.test(value)
  if (Array.isArray(value)) return value.some((item) => containsSecret(item))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsSecret(entryValue, entryKey),
    )
  }
  return false
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('interval denominator must be positive')
  if (numerator <= 0n) return 0n
  return (numerator + denominator - 1n) / denominator
}

function toSafeNumber(value: bigint, name: string): number {
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return Number(value)
}

function parseDisplayedValue(
  displayedValue: string,
  decimalPlaces: number,
): { scaledValue: bigint; scale: bigint } {
  safeInteger(decimalPlaces, 'decimalPlaces')
  if (decimalPlaces > 9) {
    throw new Error('decimalPlaces must not exceed 9')
  }
  const pattern =
    decimalPlaces === 0
      ? /^\d+$/
      : new RegExp(`^\\d+\\.\\d{${decimalPlaces}}$`)
  if (!pattern.test(displayedValue)) {
    throw new Error('displayedValue does not match decimalPlaces')
  }
  const [whole, fraction = ''] = displayedValue.split('.')
  const scale = 10n ** BigInt(decimalPlaces)
  const scaledValue = BigInt(whole) * scale + BigInt(fraction || '0')
  return { scaledValue, scale }
}

export function providerDisplayReadingToByteInterval(
  reading: SupabaseRevision4ProviderDisplayReading,
): { lowerBoundBytes: number; upperBoundBytes: number } {
  const { scaledValue, scale } = parseDisplayedValue(
    reading.displayedValue,
    reading.decimalPlaces,
  )
  const unitBytes = DISPLAY_UNIT_BYTES[reading.unit]
  if (!unitBytes) throw new Error('provider display unit is unsupported')

  let lower: bigint
  let upper: bigint
  if (reading.roundingRule === 'exact') {
    const numerator = scaledValue * unitBytes
    if (numerator % scale !== 0n) {
      throw new Error('exact display value does not resolve to whole bytes')
    }
    lower = numerator / scale
    upper = lower
  } else if (reading.roundingRule === 'nearest_half_up') {
    const denominator = 2n * scale
    lower = ceilDiv((2n * scaledValue - 1n) * unitBytes, denominator)
    upper = ceilDiv((2n * scaledValue + 1n) * unitBytes, denominator) - 1n
  } else if (reading.roundingRule === 'truncate_down') {
    lower = ceilDiv(scaledValue * unitBytes, scale)
    upper = ceilDiv((scaledValue + 1n) * unitBytes, scale) - 1n
  } else {
    throw new Error('provider display rounding rule is unsupported')
  }

  if (upper < lower) {
    throw new Error('provider display interval is empty')
  }
  return {
    lowerBoundBytes: toSafeNumber(lower, 'provider display lower bound'),
    upperBoundBytes: toSafeNumber(upper, 'provider display upper bound'),
  }
}

function assertIdentity(input: SupabaseRevision4ProviderCaptureInput): void {
  if (
    input.schemaVersion !== 1 ||
    input.profileId !== SUPABASE_REVISION4_PROFILE.profileId ||
    input.profileRevision !== SUPABASE_REVISION4_PROFILE.revision ||
    input.profileIdentityDigest !== SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  ) {
    throw new Error('revision4 provider capture identity mismatch')
  }
}

export function buildSupabaseRevision4ProviderCaptureEvidence(
  input: SupabaseRevision4ProviderCaptureInput,
): SupabaseRevision4ProviderCaptureEvidence {
  assertIdentity(input)
  if (containsSecret(input)) {
    throw new Error('provider capture input contains secret material')
  }
  if (!CAPTURE_ID_PATTERN.test(input.captureId)) {
    throw new Error('captureId is invalid')
  }
  if (!validDigest(input.projectIdentityDigest)) {
    throw new Error('projectIdentityDigest is invalid')
  }
  if (!validDigest(input.application.accountingDigest)) {
    throw new Error('application accounting digest is invalid')
  }
  if (!COMMIT_PATTERN.test(input.application.sourceCommit)) {
    throw new Error('application source commit is invalid')
  }
  safeInteger(input.application.sourceRunId, 'application source run id', 1)
  safeInteger(
    input.application.rollingBillableEgressUpperBoundBytes,
    'application rolling billable egress upper bound',
  )
  safeInteger(
    input.application.retainedUnexplainedDeltaReserveBytes,
    'application retained unexplained delta reserve',
  )
  const beforeInvocations = safeInteger(
    input.providerUsageFreshness.beforeEdgeFunctionInvocations,
    'provider usage BEFORE edge function invocations',
  )
  const afterInvocations = safeInteger(
    input.providerUsageFreshness.afterEdgeFunctionInvocations,
    'provider usage AFTER edge function invocations',
  )

  const periodStart = canonicalUtc(input.billingPeriodStart, 'billingPeriodStart')
  const periodEnd = canonicalUtc(input.billingPeriodEnd, 'billingPeriodEnd')
  const authorizationCreatedAt = canonicalUtc(
    input.authorization.createdAt,
    'authorization.createdAt',
  )
  const beforeCapturedAt = canonicalUtc(input.before.capturedAt, 'before.capturedAt')
  const afterCapturedAt = canonicalUtc(input.after.capturedAt, 'after.capturedAt')
  if (periodStart >= periodEnd) {
    throw new Error('billing period must have positive duration')
  }
  if (authorizationCreatedAt >= beforeCapturedAt) {
    throw new Error('dashboard capture authorization must precede BEFORE capture')
  }
  if (
    beforeCapturedAt < periodStart ||
    beforeCapturedAt >= periodEnd ||
    afterCapturedAt <= beforeCapturedAt ||
    afterCapturedAt > periodEnd
  ) {
    throw new Error('capture timestamps must be ordered inside one billing period')
  }
  nonEmptyArtifacts([input.before.sourceArtifact], 'before source artifact')
  nonEmptyArtifacts([input.after.sourceArtifact], 'after source artifact')
  if (!validDigest(input.before.sourceArtifactDigest)) {
    throw new Error('before source artifact digest is invalid')
  }
  if (!validDigest(input.after.sourceArtifactDigest)) {
    throw new Error('after source artifact digest is invalid')
  }
  nonEmptyArtifacts(
    input.concurrentTraffic.evidenceArtifacts,
    'concurrent traffic evidence artifacts',
  )
  artifactDigests(
    input.concurrentTraffic.evidenceArtifactDigests,
    input.concurrentTraffic.evidenceArtifacts.length,
    'concurrent traffic evidence artifact digests',
  )
  nonEmptyArtifacts(
    [input.authorization.evidenceArtifact],
    'authorization evidence artifact',
  )

  const beforeInterval = providerDisplayReadingToByteInterval(input.before)
  const afterInterval = providerDisplayReadingToByteInterval(input.after)
  const authorizationVerified =
    input.captureState === 'authorized_dashboard_capture' &&
    input.authorization.issueNumber === 1261 &&
    Number.isSafeInteger(input.authorization.commentId) &&
    Number(input.authorization.commentId) > 0 &&
    input.authorization.actor === 'badjoke-lab' &&
    input.authorization.scope === 'r4f_g3_dashboard_capture' &&
    input.authorization.sourceCommit === input.application.sourceCommit &&
    COMMIT_PATTERN.test(input.authorization.sourceCommit) &&
    validDigest(input.authorization.evidenceDigest)

  const providerSurfaceVerified =
    input.providerSurface.source === 'organization_usage_page' &&
    input.providerSurface.metric === 'total_egress' &&
    input.providerSurface.projectFilterApplied === true &&
    input.providerSurface.selectedProjectIdentityDigest ===
      input.projectIdentityDigest &&
    input.providerSurface.billingPeriodFilterApplied === true &&
    input.providerSurface.cachedEgressIncluded === true

  const invocationDelta = afterInvocations - beforeInvocations
  const providerUsageFresh = invocationDelta >= 1

  const reconciliation = reconcileSupabaseRevision4ProviderInterval({
    schemaVersion: 1,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    captureKind:
      input.captureState === 'authorized_dashboard_capture'
        ? 'dashboard_bounded_experiment'
        : 'synthetic_planning',
    applicationRollingBillableEgressUpperBoundBytes:
      input.application.rollingBillableEgressUpperBoundBytes,
    retainedUnexplainedDeltaReserveBytes:
      input.application.retainedUnexplainedDeltaReserveBytes,
    providerBefore: beforeInterval,
    providerAfter: afterInterval,
    projectFilterApplied: input.providerSurface.projectFilterApplied,
    sameProjectIdentity:
      input.providerSurface.selectedProjectIdentityDigest ===
      input.projectIdentityDigest,
    sameBillingPeriod: input.providerSurface.billingPeriodFilterApplied,
    concurrentProviderTrafficExcluded: input.concurrentTraffic.excluded,
    experimentAuthorized: authorizationVerified && providerSurfaceVerified,
    providerCapabilities: input.providerCapabilities,
    safety: input.safety,
  })

  return {
    schemaVersion: 1,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    captureState: input.captureState,
    captureId: input.captureId,
    projectIdentityDigest: input.projectIdentityDigest,
    providerSurface: input.providerSurface,
    providerSurfaceVerified,
    billingPeriodStart: input.billingPeriodStart,
    billingPeriodEnd: input.billingPeriodEnd,
    before: { ...input.before, ...beforeInterval },
    after: { ...input.after, ...afterInterval },
    providerUsageFreshness: {
      ...input.providerUsageFreshness,
      invocationDelta,
      verified: providerUsageFresh,
    },
    application: input.application,
    concurrentTraffic: input.concurrentTraffic,
    authorizationVerified,
    authorizationPrecedesBefore: true,
    displayIntervalsVerified: true,
    sameProjectIdentity: true,
    sameBillingPeriod: true,
    reconciliation,
    g3Qualified:
      authorizationVerified &&
      providerSurfaceVerified &&
      providerUsageFresh &&
      reconciliation.g3Qualified,
    profileSelected: false,
    r5Authorized: false,
  }
}
