import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

// Changes to this final G8 reconciler must trigger the guarded Supabase remote verifier.

const runIdText = process.env.GITHUB_RUN_ID ?? ''
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()
if (!/^[1-9][0-9]*$/u.test(runIdText)) throw new Error('GITHUB_RUN_ID must be a positive integer')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('GITHUB_SHA must be an exact lowercase commit SHA')
const sourceRunId = Number(runIdText)
if (!Number.isSafeInteger(sourceRunId)) throw new Error('GITHUB_RUN_ID exceeds the safe integer range')

const evidenceDirectory = 'supabase-remote-probe-evidence'
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 2
const profileIdentityDigest = 'c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998'

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function requireTrue(value, name) {
  if (value !== true) throw new Error(`${name} must be true`)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

async function evidence(name) {
  return object(
    JSON.parse(await readFile(`${evidenceDirectory}/${name}`, 'utf8')),
    name,
  )
}

function requireRunIdentity(value, name) {
  if (value.sourceRunId !== sourceRunId || value.sourceCommit !== sourceCommit) {
    throw new Error(`${name} is not bound to the current run and commit`)
  }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const [provider, memory, runtime, plan] = await Promise.all([
    evidence('provider-metric-capability.json'),
    evidence('steady-memory-capability.json'),
    evidence('runtime-resource-log-snapshot.json'),
    evidence('org-usage-billing-snapshot.json'),
  ])

  requireRunIdentity(provider, 'provider metric capability')
  requireRunIdentity(runtime, 'runtime resource snapshot')
  requireRunIdentity(plan, 'Management plan snapshot')

  if (
    provider.purpose !== 'r4c2d-provider-metric-capability'
    || memory.purpose !== 'r4c2d-steady-memory-capability'
    || runtime.purpose !== 'r4c2d-function-combined-stats-snapshot'
    || plan.purpose !== 'r4c2d-management-plan-snapshot'
  ) {
    throw new Error('G8 evidence purpose identity changed')
  }

  for (const [name, value] of Object.entries({
    providerCoverageNotOverstated: provider.checks?.providerCoverageNotOverstated,
    exactProjectOrganizationBinding: plan.checks?.exactProjectOrganizationBinding,
    freePlanConfirmed: plan.checks?.freePlanConfirmed,
    officialCombinedStatsEndpoint: runtime.checks?.officialCombinedStatsEndpoint,
    exactActiveFunctionCoverage: runtime.checks?.exactActiveFunctionCoverage,
    zeroRssNotAccepted: memory.checks?.zeroRssNotInterpretedAsZeroUsage,
    partialHeapNotSubstituted: memory.checks?.partialHeapCountersNotSubstitutedForRss,
    memoryCoverageNotOverstated: memory.checks?.memoryCoverageNotOverstated,
  })) requireTrue(value, name)

  if (
    provider.checks?.g8Qualified !== false
    || provider.checks?.profileSelected !== false
    || memory.checks?.g8Qualified !== false
    || memory.checks?.profileSelected !== false
  ) {
    throw new Error('source evidence overstated G8 or profile selection')
  }

  const exactPeakMemoryAvailable = provider.coverage?.exactPeakEdgeMemoryAvailable === true
  const providerEgressAvailable = provider.coverage?.providerEgressBytesAvailable === true
  const exactRuntimeMemoryAvailable = memory.usableTotalMemoryCounter === true
  const exactMemoryHeadroomQualified = memory.checks?.memoryHeadroomQualified === true

  const failureReasons = []
  if (!exactPeakMemoryAvailable) failureReasons.push('provider_exact_peak_memory_unavailable')
  if (!providerEgressAvailable) failureReasons.push('provider_egress_bytes_unavailable')
  if (!exactRuntimeMemoryAvailable) failureReasons.push('runtime_total_memory_counter_unavailable')
  if (!exactMemoryHeadroomQualified) failureReasons.push('memory_headroom_not_qualified')

  const status = failureReasons.length > 0 ? 'fail' : 'unresolved'
  const disposition = failureReasons.length > 0
    ? 'reject_profile'
    : 'additional_exact_value_and_threshold_evidence_required'

  const core = {
    schemaVersion: 1,
    purpose: 'r4c2d-g8-resource-disposition',
    evaluatedAt: new Date().toISOString(),
    sourceRunId,
    sourceCommit,
    profileId,
    profileRevision,
    profileIdentityDigest,
    gateId: 'G8',
    status,
    disposition,
    failureReasons,
    providerCapability: {
      patUsageApiCounts: provider.coverage?.patUsageApiCounts === true,
      patUsageApiRequestsCount: provider.coverage?.patUsageApiRequestsCount === true,
      patFunctionsCombinedStats: provider.coverage?.patFunctionsCombinedStats === true,
      patMetricsEndpoint: provider.coverage?.patMetricsEndpoint === true,
      dashboardOrgDailyUsageWithPat: provider.coverage?.dashboardOrgDailyUsageWithPat === true,
      requestCountsAvailable: provider.coverage?.requestCountsAvailable === true,
      averageMemoryAvailable: provider.coverage?.averageMemoryAvailable === true,
      providerEgressBytesAvailable: providerEgressAvailable,
      exactPeakEdgeMemoryAvailable: exactPeakMemoryAvailable,
    },
    memoryCapability: {
      sampleCount: memory.sampleCount,
      allRssCountersZero: memory.allRssCountersZero,
      partialHeapCountersAvailable: memory.partialHeapCountersAvailable,
      usableTotalMemoryCounter: exactRuntimeMemoryAvailable,
      memoryHeadroomQualified: exactMemoryHeadroomQualified,
    },
    retainedPasses: {
      officialCombinedStatistics: true,
      exactActiveFunctionCoverage: true,
      freePlanNoCharge: true,
      providerCoverageNotOverstated: true,
      memoryCoverageNotOverstated: true,
    },
    checks: {
      providerCapabilityProbeCompleted: true,
      hardGateFailureIndependentOfOtherPassingResources: true,
      requestCountsNotSubstitutedForEgressBytes: true,
      averageMemoryNotSubstitutedForPeakMemory: true,
      partialHeapNotSubstitutedForTotalMemory: true,
      zeroRssNotSubstitutedForZeroUsage: true,
      theoreticalProjectionNotSubstitutedForProviderEvidence: true,
      unavailableHardGateEvidenceCausesFailure: failureReasons.length > 0,
      profileRejectedWhenG8Fails: failureReasons.length > 0,
      g8Qualified: false,
      profileSelected: false,
    },
  }
  const result = { ...core, evidenceDigest: digest(core) }

  await writeFile(
    `${evidenceDirectory}/g8-resource-disposition.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(JSON.stringify(result))
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r4c2d-g8-resource-disposition',
    sourceRunId,
    sourceCommit,
    profileId,
    profileRevision,
    profileIdentityDigest,
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
    checks: {
      g8Qualified: false,
      profileSelected: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-g8-resource-disposition.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}