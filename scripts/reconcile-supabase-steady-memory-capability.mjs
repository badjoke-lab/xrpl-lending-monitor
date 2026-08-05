import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const evidenceDirectory = 'supabase-remote-probe-evidence'
const steadyPath = `${evidenceDirectory}/verified-steady-throughput.json`
const capabilityPath = `${evidenceDirectory}/steady-memory-capability.json`
const retainedMemoryFixturePath = new URL(
  './fixtures/r5-retained-steady-memory-samples.json',
  import.meta.url,
)
const retainedSessionId = 'r4c2d-steady-msflb8fo-5ebc5adc'
const sourceWorkflowRunId = 30975277983
const sourceCommit = 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c'
const sourceArtifactId = 8918144753
const sourceArtifactDigest = 'sha256:c0f519dc4a1fe5dfff3f0ae79641cc84fd54e99fb2f0b2d073f20639e1dda2ac'
const sourceSteadyEvidenceSha256 = 'fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c'
const memoryCanonicalSha256 = 'e8c359e23189c37c4f74aa3e66a83913a26977dca6b91896804cd1c48c992f40'

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function nonNegativeInteger(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function canonicalDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function restoreRetainedMemory(evidence) {
  if (Array.isArray(evidence.memory?.ticks)) return false

  const retainedSource = object(evidence.retainedSource, 'retained steady source')
  if (
    evidence.retainedDuringR5Recovery !== true
    || evidence.sessionId !== retainedSessionId
    || retainedSource.purpose !== 'r5-retained-qualification-evidence-verification'
    || retainedSource.sourceWorkflowRunId !== sourceWorkflowRunId
    || retainedSource.sourceCommit !== sourceCommit
    || retainedSource.sourceArtifactId !== sourceArtifactId
    || retainedSource.sourceArtifactDigest !== sourceArtifactDigest
    || retainedSource.sourceSteadyEvidenceSha256 !== sourceSteadyEvidenceSha256
    || retainedSource.retainedSteadySessionId !== retainedSessionId
    || retainedSource.checks?.exactSourceArtifactPinned !== true
    || retainedSource.checks?.steadyEvidenceRetained !== true
    || retainedSource.checks?.noFreshQualificationExecuted !== true
  ) {
    throw new Error('retained steady memory source identity is invalid')
  }

  const fixture = object(
    JSON.parse(await readFile(retainedMemoryFixturePath, 'utf8')),
    'retained steady memory fixture',
  )
  const memory = object(fixture.memory, 'retained steady memory')
  if (
    fixture.schemaVersion !== 1
    || fixture.purpose !== 'r5-retained-steady-memory-samples'
    || fixture.sourceWorkflowRunId !== sourceWorkflowRunId
    || fixture.sourceCommit !== sourceCommit
    || fixture.sourceArtifactId !== sourceArtifactId
    || fixture.sourceArtifactDigest !== sourceArtifactDigest
    || fixture.sourceSteadyEvidenceSha256 !== sourceSteadyEvidenceSha256
    || fixture.memoryCanonicalSha256 !== memoryCanonicalSha256
    || canonicalDigest(memory) !== memoryCanonicalSha256
    || memory.schemaVersion !== 1
    || memory.purpose !== 'r4c2d-steady-memory-guard'
    || memory.sessionId !== retainedSessionId
    || memory.sessionStatus !== 'completed'
    || memory.completedTicks !== 6
    || memory.measuredCompletedTicks !== 6
    || !Array.isArray(memory.ticks)
    || memory.ticks.length !== 6
  ) {
    throw new Error('retained steady memory fixture identity or digest is invalid')
  }

  evidence.memory = memory
  evidence.retainedMemorySamples = {
    schemaVersion: 1,
    sourceWorkflowRunId,
    sourceCommit,
    sourceArtifactId,
    sourceArtifactDigest,
    sourceSteadyEvidenceSha256,
    memoryCanonicalSha256,
    restoredFromPinnedFixture: true,
    noFreshQualificationExecuted: true,
  }
  return true
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const evidence = object(JSON.parse(await readFile(steadyPath, 'utf8')), 'steady evidence')
  const retainedMemoryRestored = await restoreRetainedMemory(evidence)
  if (
    evidence.purpose !== 'r4c2d-network-steady-throughput-verification'
    || evidence.checks?.g7Qualified !== true
    || evidence.checks?.g8Qualified !== false
    || !Array.isArray(evidence.memory?.ticks)
  ) {
    throw new Error('steady memory capability source identity is invalid')
  }

  const completedTicks = evidence.memory.ticks.filter((tick) => tick?.status === 'completed')
  if (completedTicks.length !== 6) throw new Error('steady memory capability requires six completed ticks')

  const samples = []
  for (const [tickIndex, tickValue] of completedTicks.entries()) {
    const tick = object(tickValue, `memory tick ${tickIndex + 1}`)
    if (!Array.isArray(tick.memorySamples) || tick.memorySamples.length < 6) {
      throw new Error(`memory tick ${tickIndex + 1} has incomplete samples`)
    }
    for (const [sampleIndex, sampleValue] of tick.memorySamples.entries()) {
      const sample = object(sampleValue, `memory tick ${tickIndex + 1} sample ${sampleIndex + 1}`)
      samples.push({
        rssBytes: nonNegativeInteger(sample.rssBytes, 'rssBytes'),
        heapTotalBytes: nonNegativeInteger(sample.heapTotalBytes, 'heapTotalBytes'),
        heapUsedBytes: nonNegativeInteger(sample.heapUsedBytes, 'heapUsedBytes'),
        externalBytes: nonNegativeInteger(sample.externalBytes, 'externalBytes'),
      })
    }
  }

  const allRuntimeCountersZero = samples.every((sample) =>
    sample.rssBytes === 0
    && sample.heapTotalBytes === 0
    && sample.heapUsedBytes === 0
    && sample.externalBytes === 0
  )
  const allRssCountersZero = samples.every((sample) => sample.rssBytes === 0)
  const allHeapTotalCountersZero = samples.every((sample) => sample.heapTotalBytes === 0)
  const partialHeapCountersAvailable = !allHeapTotalCountersZero
  const usableTotalMemoryCounter = !allRssCountersZero
  const reason = usableTotalMemoryCounter
    ? null
    : 'Deno.memoryUsage returned zero RSS for every retained sample; nonzero heap or external counters cannot prove total Edge memory high water'

  const capability = {
    schemaVersion: 2,
    purpose: 'r4c2d-steady-memory-capability',
    reconciledAt: new Date().toISOString(),
    sourceSessionId: evidence.sessionId,
    completedTicks: completedTicks.length,
    sampleCount: samples.length,
    allRuntimeCountersZero,
    allRssCountersZero,
    allHeapTotalCountersZero,
    partialHeapCountersAvailable,
    usableTotalMemoryCounter,
    usableRuntimeCounters: usableTotalMemoryCounter,
    reason,
    retainedMemoryRestored,
    retainedMemoryCanonicalSha256: retainedMemoryRestored ? memoryCanonicalSha256 : null,
    checks: {
      sixTicksInspected: completedTicks.length === 6,
      samplesInspected: samples.length >= 36,
      lifecycleSamplingExecuted: true,
      rssCounterRequiredForTotalMemoryQualification: true,
      runtimeMemoryMeasurementAvailable: usableTotalMemoryCounter,
      partialHeapCountersNotSubstitutedForRss: true,
      zeroRssNotInterpretedAsZeroUsage: true,
      zeroCountersNotInterpretedAsZeroUsage: true,
      memoryHeadroomQualified: usableTotalMemoryCounter,
      memoryCoverageNotOverstated: true,
      retainedMemorySourcePinned: !retainedMemoryRestored || canonicalDigest(evidence.memory) === memoryCanonicalSha256,
      noFreshQualificationExecuted: !retainedMemoryRestored || evidence.retainedSource?.checks?.noFreshQualificationExecuted === true,
      g8Qualified: false,
      profileSelected: false,
    },
  }

  evidence.memoryCapability = capability
  evidence.memorySummary = usableTotalMemoryCounter
    ? {
        ...evidence.memorySummary,
        runtimeMemoryMeasurementAvailable: true,
        memoryHeadroomQualified: true,
      }
    : {
        runtimeMemoryMeasurementAvailable: false,
        measurementReason: reason,
        minimumMemoryHighWaterBytes: null,
        p50MemoryHighWaterBytes: null,
        p95MemoryHighWaterBytes: null,
        maximumMemoryHighWaterBytes: null,
        memoryHaltBytes: evidence.memorySummary?.memoryHaltBytes ?? 209715200,
        memoryHardBytes: evidence.memorySummary?.memoryHardBytes ?? 268435456,
        memoryHeadroomBytes: null,
        allSixTicksBelowHalt: null,
        memoryHeadroomQualified: false,
      }
  evidence.checks = {
    ...evidence.checks,
    sixCompletedTicksMemorySamplesRecorded: true,
    sixCompletedTicksMemoryMeasured: usableTotalMemoryCounter,
    requiredMemoryPhasesSampled: true,
    requiredMemoryPhasesMeasured: usableTotalMemoryCounter,
    memoryHighWaterRecalculated: usableTotalMemoryCounter,
    memoryRecordedBeforeCommit: true,
    memoryFailClosedBelowHardLimit: usableTotalMemoryCounter,
    memoryMeasurementAvailable: usableTotalMemoryCounter,
    partialHeapCountersNotSubstitutedForRss: true,
    memoryCoverageNotOverstated: true,
    memoryQualified: usableTotalMemoryCounter,
    retainedMemorySourcePinned: !retainedMemoryRestored || canonicalDigest(evidence.memory) === memoryCanonicalSha256,
    g8Qualified: false,
    profileSelected: false,
  }

  await writeFile(steadyPath, `${JSON.stringify(evidence, null, 2)}\n`)
  await writeFile(capabilityPath, `${JSON.stringify(capability, null, 2)}\n`)
  console.log(JSON.stringify(capability))
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 2,
    purpose: 'r4c2d-steady-memory-capability',
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    checks: {
      g8Qualified: false,
      profileSelected: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-steady-memory-capability.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
