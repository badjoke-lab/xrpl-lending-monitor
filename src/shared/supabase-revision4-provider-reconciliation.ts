import {
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

export type SupabaseRevision4ProviderCaptureKind =
  | 'synthetic_planning'
  | 'dashboard_bounded_experiment'

export interface SupabaseRevision4ProviderByteInterval {
  lowerBoundBytes: number
  upperBoundBytes: number
}

export interface SupabaseRevision4ProviderReconciliationInput {
  schemaVersion: 1
  profileId: typeof SUPABASE_REVISION4_PROFILE.profileId
  profileRevision: typeof SUPABASE_REVISION4_PROFILE.revision
  profileIdentityDigest: typeof SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  captureKind: SupabaseRevision4ProviderCaptureKind
  applicationRollingBillableEgressUpperBoundBytes: number
  retainedUnexplainedDeltaReserveBytes: number
  providerBefore: SupabaseRevision4ProviderByteInterval
  providerAfter: SupabaseRevision4ProviderByteInterval
  projectFilterApplied: boolean
  sameProjectIdentity: boolean
  sameBillingPeriod: boolean
  concurrentProviderTrafficExcluded: boolean
  experimentAuthorized: boolean
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

export interface SupabaseRevision4ProviderReconciliationResult {
  schemaVersion: 1
  profileId: typeof SUPABASE_REVISION4_PROFILE.profileId
  profileRevision: typeof SUPABASE_REVISION4_PROFILE.revision
  profileIdentityDigest: typeof SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  captureKind: SupabaseRevision4ProviderCaptureKind
  providerDeltaInterval: SupabaseRevision4ProviderByteInterval
  providerDeltaIntervalWidthBytes: number
  counterResetOrScopeChangeDetected: boolean
  newlyRequiredUnexplainedDeltaReserveBytes: number
  selectedUnexplainedDeltaReserveBytes: number
  applicationCoveredUpperBoundBytes: number
  exactAutomatedProviderReconciliationAvailable: boolean
  exactProviderReconciliationClaimed: false
  intervalReconciliationReady: boolean
  intervalUpperBoundCovered: boolean
  g3Qualified: boolean
  profileSelected: false
  r5Authorized: false
  checks: {
    exactRevision4Identity: true
    providerValuesAreIntervals: true
    providerGranularityNotOverstated: true
    syntheticInputNotAcceptedAsProviderEvidence: boolean
    sameProjectAndBillingPeriod: boolean
    concurrentProviderTrafficExcluded: boolean
    noCounterResetOrScopeChange: boolean
    noProviderOrRecoveryMutation: boolean
  }
}

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function safeAdd(left: number, right: number, name: string): number {
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return value
}

function normalizeInterval(
  value: SupabaseRevision4ProviderByteInterval,
  name: string,
): SupabaseRevision4ProviderByteInterval {
  const lowerBoundBytes = nonNegativeSafeInteger(
    value.lowerBoundBytes,
    `${name}.lowerBoundBytes`,
  )
  const upperBoundBytes = nonNegativeSafeInteger(
    value.upperBoundBytes,
    `${name}.upperBoundBytes`,
  )
  if (lowerBoundBytes > upperBoundBytes) {
    throw new Error(`${name} lower bound must not exceed its upper bound`)
  }
  return { lowerBoundBytes, upperBoundBytes }
}

function assertIdentity(input: SupabaseRevision4ProviderReconciliationInput): void {
  if (
    input.schemaVersion !== 1 ||
    input.profileId !== SUPABASE_REVISION4_PROFILE.profileId ||
    input.profileRevision !== SUPABASE_REVISION4_PROFILE.revision ||
    input.profileIdentityDigest !== SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  ) {
    throw new Error('revision4 provider reconciliation identity mismatch')
  }
}

export function reconcileSupabaseRevision4ProviderInterval(
  input: SupabaseRevision4ProviderReconciliationInput,
): SupabaseRevision4ProviderReconciliationResult {
  assertIdentity(input)
  const applicationUpper = nonNegativeSafeInteger(
    input.applicationRollingBillableEgressUpperBoundBytes,
    'applicationRollingBillableEgressUpperBoundBytes',
  )
  const retainedReserve = nonNegativeSafeInteger(
    input.retainedUnexplainedDeltaReserveBytes,
    'retainedUnexplainedDeltaReserveBytes',
  )
  const before = normalizeInterval(input.providerBefore, 'providerBefore')
  const after = normalizeInterval(input.providerAfter, 'providerAfter')

  const counterResetOrScopeChangeDetected =
    after.upperBoundBytes < before.lowerBoundBytes
  const providerDeltaLowerBoundBytes = counterResetOrScopeChangeDetected
    ? 0
    : Math.max(0, after.lowerBoundBytes - before.upperBoundBytes)
  const providerDeltaUpperBoundBytes = counterResetOrScopeChangeDetected
    ? 0
    : Math.max(0, after.upperBoundBytes - before.lowerBoundBytes)
  const providerDeltaIntervalWidthBytes =
    providerDeltaUpperBoundBytes - providerDeltaLowerBoundBytes
  const newlyRequiredUnexplainedDeltaReserveBytes = Math.max(
    0,
    providerDeltaUpperBoundBytes - applicationUpper,
  )
  const selectedUnexplainedDeltaReserveBytes = Math.max(
    retainedReserve,
    newlyRequiredUnexplainedDeltaReserveBytes,
  )
  const applicationCoveredUpperBoundBytes = safeAdd(
    applicationUpper,
    selectedUnexplainedDeltaReserveBytes,
    'application covered upper bound',
  )

  const sameProjectAndBillingPeriod =
    input.projectFilterApplied &&
    input.sameProjectIdentity &&
    input.sameBillingPeriod
  const noProviderOrRecoveryMutation =
    input.safety.providerMutationPerformed === false &&
    input.safety.productionMigrationPerformed === false &&
    input.safety.recoveryMutationCommitted === false &&
    input.safety.publicReaderUnchanged === true &&
    input.safety.mainnetDisabled === true &&
    input.safety.stabilizationAuthorized === false &&
    input.safety.soakAuthorized === false
  const syntheticInputNotAcceptedAsProviderEvidence =
    input.captureKind !== 'synthetic_planning'
  const intervalReconciliationReady =
    input.captureKind === 'dashboard_bounded_experiment' &&
    input.experimentAuthorized &&
    sameProjectAndBillingPeriod &&
    input.concurrentProviderTrafficExcluded &&
    !counterResetOrScopeChangeDetected &&
    noProviderOrRecoveryMutation
  const intervalUpperBoundCovered =
    applicationCoveredUpperBoundBytes >= providerDeltaUpperBoundBytes
  const exactAutomatedProviderReconciliationAvailable =
    input.providerCapabilities.managementApiEgressBytesAvailable ||
    input.providerCapabilities.dashboardExactByteExportAvailable

  return {
    schemaVersion: 1,
    profileId: SUPABASE_REVISION4_PROFILE.profileId,
    profileRevision: SUPABASE_REVISION4_PROFILE.revision,
    profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    captureKind: input.captureKind,
    providerDeltaInterval: {
      lowerBoundBytes: providerDeltaLowerBoundBytes,
      upperBoundBytes: providerDeltaUpperBoundBytes,
    },
    providerDeltaIntervalWidthBytes,
    counterResetOrScopeChangeDetected,
    newlyRequiredUnexplainedDeltaReserveBytes,
    selectedUnexplainedDeltaReserveBytes,
    applicationCoveredUpperBoundBytes,
    exactAutomatedProviderReconciliationAvailable,
    exactProviderReconciliationClaimed: false,
    intervalReconciliationReady,
    intervalUpperBoundCovered,
    g3Qualified:
      intervalReconciliationReady &&
      intervalUpperBoundCovered &&
      syntheticInputNotAcceptedAsProviderEvidence,
    profileSelected: false,
    r5Authorized: false,
    checks: {
      exactRevision4Identity: true,
      providerValuesAreIntervals: true,
      providerGranularityNotOverstated: true,
      syntheticInputNotAcceptedAsProviderEvidence,
      sameProjectAndBillingPeriod,
      concurrentProviderTrafficExcluded:
        input.concurrentProviderTrafficExcluded,
      noCounterResetOrScopeChange: !counterResetOrScopeChangeDetected,
      noProviderOrRecoveryMutation,
    },
  }
}
