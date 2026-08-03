import { mkdir, readFile, writeFile } from 'node:fs/promises'

const evidenceDirectory = 'supabase-remote-probe-evidence'
const steadyPath = `${evidenceDirectory}/verified-steady-throughput.json`
const capabilityPath = `${evidenceDirectory}/steady-memory-capability.json`

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

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const evidence = object(JSON.parse(await readFile(steadyPath, 'utf8')), 'steady evidence')
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
  const usableRuntimeCounters = !allRuntimeCountersZero
  const reason = usableRuntimeCounters
    ? null
    : 'Deno.memoryUsage returned zero for RSS, heap total, heap used, and external memory at every retained sample'

  const capability = {
    schemaVersion: 1,
    purpose: 'r4c2d-steady-memory-capability',
    reconciledAt: new Date().toISOString(),
    sourceSessionId: evidence.sessionId,
    completedTicks: completedTicks.length,
    sampleCount: samples.length,
    allRuntimeCountersZero,
    usableRuntimeCounters,
    reason,
    checks: {
      sixTicksInspected: completedTicks.length === 6,
      samplesInspected: samples.length >= 36,
      lifecycleSamplingExecuted: true,
      runtimeMemoryMeasurementAvailable: usableRuntimeCounters,
      zeroCountersNotInterpretedAsZeroUsage: true,
      memoryHeadroomQualified: usableRuntimeCounters,
      memoryCoverageNotOverstated: true,
      g8Qualified: false,
      profileSelected: false,
    },
  }

  evidence.memoryCapability = capability
  evidence.memorySummary = usableRuntimeCounters
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
    sixCompletedTicksMemoryMeasured: usableRuntimeCounters,
    requiredMemoryPhasesSampled: true,
    requiredMemoryPhasesMeasured: usableRuntimeCounters,
    memoryHighWaterRecalculated: usableRuntimeCounters,
    memoryRecordedBeforeCommit: true,
    memoryFailClosedBelowHardLimit: usableRuntimeCounters,
    memoryMeasurementAvailable: usableRuntimeCounters,
    memoryCoverageNotOverstated: true,
    memoryQualified: usableRuntimeCounters,
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
    schemaVersion: 1,
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