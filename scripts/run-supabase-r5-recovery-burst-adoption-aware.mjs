import { spawnSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const sourcePath = 'scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs'
const generatedPath = `/tmp/xrpl-r5-recovery-burst-adoption-aware-${process.pid}.mjs`
const obsolete = `    adoption = normalizeAdoption(
      afterAdoptions.adoptions.at(-1),
      afterAdoptions.adoptionCount,
    )`
const corrected = `    adoption = normalizeAdoption(
      afterAdoptions.adoptions.at(-1),
      beforeAdoptions.adoptedBatchCount + 1,
    )`

const source = await readFile(sourcePath, 'utf8')
const occurrenceCount = source.split(obsolete).length - 1
if (occurrenceCount !== 1) {
  throw new Error(
    `R5 adoption sequence correction expected exactly one obsolete call, found ${occurrenceCount}`,
  )
}
if (source.includes(corrected)) {
  throw new Error('R5 adoption sequence correction is already present in source')
}

let generated = source.replace(obsolete, corrected)
if (generated === source || generated.includes(obsolete) || !generated.includes(corrected)) {
  throw new Error('R5 adoption sequence correction did not converge exactly')
}

function occurrenceCountOf(text, fragment) {
  if (fragment.length === 0) throw new Error('R5 replacement fragment must not be empty')
  return text.split(fragment).length - 1
}

function replaceExactlyOnce(name, oldText, newText) {
  const count = occurrenceCountOf(generated, oldText)
  if (count !== 1) {
    throw new Error(`${name} expected exactly one source occurrence, found ${count}`)
  }
  if (generated.includes(newText)) {
    throw new Error(`${name} is already present in source`)
  }
  const expectedRetainedOldCount = occurrenceCountOf(newText, oldText)
  const next = generated.replace(oldText, newText)
  if (
    next === generated
    || occurrenceCountOf(next, newText) !== 1
    || occurrenceCountOf(next, oldText) !== expectedRetainedOldCount
  ) {
    throw new Error(`${name} did not converge exactly`)
  }
  generated = next
}

replaceExactlyOnce(
  'R5 executor-only cycle boundary',
  `  if (
    advancedBatches < 0
    || advancedLedgers < 0
    || advancedBatches > remainingLimit
    || ![0, 1].includes(addedAdoptions)
  ) {`,
  `  if (
    advancedBatches < 0
    || advancedLedgers < 0
    || ![0, 1].includes(addedAdoptions)
  ) {`,
)

replaceExactlyOnce(
  'R5 executor batch counter declaration',
  `  let adoption = null
  let adoptedBatchCount = 0
  if (addedAdoptions === 1) {`,
  `  let adoption = null
  let adoptedBatchCount = 0
  let executorBatchCount = 0
  if (addedAdoptions === 1) {`,
)

replaceExactlyOnce(
  'R5 executor batch counter assignment',
  `    const executorBatchCount = advancedBatches - adoptedBatchCount`,
  `    executorBatchCount = advancedBatches - adoptedBatchCount`,
)

replaceExactlyOnce(
  'R5 executor batch remaining-budget guard',
  `      || adoptedBatchCount < 1
      || ![0, 1].includes(executorBatchCount)`,
  `      || adoptedBatchCount < 1
      || ![0, 1].includes(executorBatchCount)
      || executorBatchCount > remainingLimit`,
)

replaceExactlyOnce(
  'R5 non-adoption executor batch assignment',
  `  } else if (advancedBatches !== 1) {
    throw new Error('R5 trigger advanced multiple batches without one adoption record')
  }

  const batches = []`,
  `  } else if (advancedBatches !== 1) {
    throw new Error('R5 trigger advanced multiple batches without one adoption record')
  } else {
    executorBatchCount = 1
  }

  const batches = []`,
)

replaceExactlyOnce(
  'R5 cycle executor count result',
  `    advancedBatches,
    advancedLedgers,
  }
}`,
  `    advancedBatches,
    advancedLedgers,
    executorBatchCount,
  }
}`,
)

replaceExactlyOnce(
  'R5 burst executor counter initialization',
  `  const cycles = []
  let stopReason = null
  let transientRetries = 0

  while (batches.length < batchLimit) {`,
  `  const cycles = []
  let stopReason = null
  let transientRetries = 0
  let executedBatchCount = 0

  while (executedBatchCount < batchLimit) {`,
)

replaceExactlyOnce(
  'R5 remaining executor budget',
  `    const remainingLimit = batchLimit - batches.length`,
  `    const remainingLimit = batchLimit - executedBatchCount`,
)

replaceExactlyOnce(
  'R5 accumulated executor budget',
  `    batches.push(...cycleBatches)
    adoptions.push(...result.cycle.adoptions)
    cycles.push({`,
  `    batches.push(...cycleBatches)
    adoptions.push(...result.cycle.adoptions)
    executedBatchCount += result.cycle.executorBatchCount
    cycles.push({`,
)

replaceExactlyOnce(
  'R5 cycle executor evidence',
  `      advancedBatches: result.cycle.advancedBatches,
      advancedLedgers: result.cycle.advancedLedgers,`,
  `      advancedBatches: result.cycle.advancedBatches,
      advancedLedgers: result.cycle.advancedLedgers,
      executorBatchCount: result.cycle.executorBatchCount,`,
)

replaceExactlyOnce(
  'R5 final executor budget guard',
  `    || batches.length > batchLimit
    || Date.now() > deadlineMilliseconds + 30_000`,
  `    || executedBatchCount > batchLimit
    || Date.now() > deadlineMilliseconds + 30_000`,
)

replaceExactlyOnce(
  'R5 executor and materialized batch evidence',
  `    requestedBatchLimit: batchLimit,
    wallSeconds,
    elapsedMilliseconds: Date.now() - startedAtMilliseconds,`,
  `    requestedBatchLimit: batchLimit,
    requestedExecutorBatchLimit: batchLimit,
    executedRecoveryBatches: executedBatchCount,
    materializedBatchRows: batches.length,
    wallSeconds,
    elapsedMilliseconds: Date.now() - startedAtMilliseconds,`,
)

replaceExactlyOnce(
  'R5 bounded executor evidence check',
  `      boundedBatchLimit: batchLimit <= 64 && batches.length <= batchLimit,`,
  `      boundedBatchLimit: batchLimit <= 64 && executedBatchCount <= batchLimit,
      adoptionRowsExcludedFromExecutorBudget:
        batches.length - executedBatchCount
        === batches.filter((batch) => batch.origin === 'adopted_active_descendant').length,`,
)

await writeFile(generatedPath, generated, { encoding: 'utf8', mode: 0o600 })
try {
  if (process.env.R5_RECOVERY_ADAPTER_VALIDATE_ONLY === '1') {
    const syntaxCheck = spawnSync(process.execPath, ['--check', generatedPath], {
      encoding: 'utf8',
    })
    if (syntaxCheck.error || syntaxCheck.status !== 0) {
      throw new Error(
        `R5 generated controller syntax validation failed: ${syntaxCheck.error?.message ?? syntaxCheck.stderr.trim()}`,
      )
    }
  } else {
    await import(pathToFileURL(generatedPath).href)
  }
} finally {
  await rm(generatedPath, { force: true })
}
