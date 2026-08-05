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
  'R5 zero-progress executor count result',
  `    return { batches: [], adoptions: [], advancedBatches: 0, advancedLedgers: 0 }`,
  `    return {
      batches: [],
      adoptions: [],
      advancedBatches: 0,
      advancedLedgers: 0,
      executorBatchCount: 0,
    }`,
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
  'R5 final boundary trigger helper',
  `  return object(body, 'R5 trigger response')
}

async function verifyCycle(before, beforeAdoptions, after, afterAdoptions, remainingLimit) {`,
  `  return object(body, 'R5 trigger response')
}

async function invokeFinalizationTrigger() {
  const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
  if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) {
    throw new Error('GITHUB_RUN_ID must be a positive integer for R5 finalization')
  }

  let response
  try {
    response = await fetch(triggerEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-xrpl-r5-purpose': purpose,
        'x-xrpl-r5-token': verifierToken,
      },
      body: JSON.stringify({
        source: 'github_actions',
        run_id: recoveryRunId,
        mode: 'finalize_boundary',
        source_run_id: sourceRunId,
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (error) {
    throw new TriggerError(
      \`R5 finalization trigger transport failed: \${error instanceof Error ? error.message : String(error)}\`,
      { transient: false },
    )
  }

  const text = await response.text()
  const body = parseJson(text)
  const trigger = body && typeof body === 'object' ? body.trigger : null
  if (
    !trigger
    || typeof trigger !== 'object'
    || body.operationMode !== 'finalize_boundary'
    || trigger.combinedProxyBytesWithinFixedReserve !== true
    || trigger.twoInvocationReservationUsed !== true
    || trigger.serviceKeyNotReturned !== true
    || trigger.noLedgerScanInFinalizationMode !== true
    || requiredInteger(trigger.fixedFunctionResponseReserveBytes, 'finalization fixed response reserve')
      !== 131072
    || requiredInteger(trigger.combinedProxyBytes, 'finalization combined proxy bytes') >= 131072
  ) {
    throw new TriggerError('R5 finalization trigger proxy boundary changed', {
      response: body,
    })
  }
  if (!response.ok) {
    throw new TriggerError(
      \`R5 finalization trigger failed (\${response.status}): \${JSON.stringify(body).slice(0, 2_000)}\`,
      { transient: false, response: body },
    )
  }

  const finalization = object(body.finalization, 'R5 finalization response')
  if (
    finalization.finalized !== true
    || finalization.runId !== recoveryRunId
    || requiredInteger(finalization.sourceRunId, 'finalization.sourceRunId') !== sourceRunId
    || requiredInteger(
      finalization.currentWatermarkLedgerIndex,
      'finalization.currentWatermarkLedgerIndex',
    ) < 1
    || !/^[A-F0-9]{64}$/.test(
      requiredString(
        finalization.currentWatermarkLedgerHash,
        'finalization.currentWatermarkLedgerHash',
      ),
    )
    || requiredString(
      finalization.currentWatermarkWorkId,
      'finalization.currentWatermarkWorkId',
    ).length < 1
    || requiredInteger(finalization.drainedStepCount, 'finalization.drainedStepCount') > 256
    || finalization.noScanExecuted !== true
    || finalization.publicReaderUnchanged !== true
    || finalization.mainnetDisabled !== true
    || finalization.stabilizationAuthorized !== false
    || finalization.soakAuthorized !== false
  ) {
    throw new Error('R5 finalization response parity failed')
  }
  return finalization
}

async function verifyCycle(before, beforeAdoptions, after, afterAdoptions, remainingLimit) {`,
)

replaceExactlyOnce(
  'R5 final boundary execution',
  `  if (stopReason === null) stopReason = 'batch_limit'

  const after = await readRecovery()`,
  `  if (stopReason === null) stopReason = 'batch_limit'

  let finalization = null
  if (current.status === 'running') {
    finalization = await invokeFinalizationTrigger()
    const finalizedRecovery = await readRecovery()
    const finalizedAdoptions = await readAdoptions()
    const finalizationCycle = await verifyCycle(
      current,
      currentAdoptions,
      finalizedRecovery,
      finalizedAdoptions,
      0,
    )
    if (finalizationCycle.executorBatchCount !== 0) {
      throw new Error('R5 final boundary executed a recovery batch')
    }
    if (finalizationCycle.advancedBatches > 0) {
      const finalizationBatches = finalizationCycle.batches.map((batch) => ({
        ...batch,
        verifierAttempt: null,
        transientRetries: 0,
      }))
      batches.push(...finalizationBatches)
      adoptions.push(...finalizationCycle.adoptions)
      cycles.push({
        kind: 'final_boundary',
        verifierAttempt: null,
        transientRetries: 0,
        advancedBatches: finalizationCycle.advancedBatches,
        advancedLedgers: finalizationCycle.advancedLedgers,
        executorBatchCount: 0,
        batchSequences: finalizationBatches.map((batch) => batch.batchSequence),
        adoptionSequences:
          finalizationCycle.adoptions.map((adoption) => adoption.adoptionSequence),
      })
    }
    if (
      requiredInteger(
        finalization.currentWatermarkLedgerIndex,
        'finalization.currentWatermarkLedgerIndex',
      ) !== finalizedRecovery.currentWatermark.ledgerIndex
      || finalization.currentWatermarkLedgerHash
        !== finalizedRecovery.currentWatermark.ledgerHash
      || finalization.currentWatermarkWorkId
        !== finalizedRecovery.currentWatermark.workId
    ) {
      throw new Error('R5 final boundary did not match recovery state')
    }
    current = finalizedRecovery
    currentAdoptions = finalizedAdoptions
  }

  const after = await readRecovery()`,
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
  'R5 finalization evidence',
  `    transientRetries,
    before: {`,
  `    transientRetries,
    finalization,
    before: {`,
)

replaceExactlyOnce(
  'R5 bounded executor evidence check',
  `      boundedBatchLimit: batchLimit <= 64 && batches.length <= batchLimit,`,
  `      boundedBatchLimit: batchLimit <= 64 && executedBatchCount <= batchLimit,
      adoptionRowsExcludedFromExecutorBudget:
        batches.length - executedBatchCount
        === batches.filter((batch) => batch.origin === 'adopted_active_descendant').length,
      finalBoundaryCompleted:
        after.status === 'caught_up' || finalization?.finalized === true,
      finalBoundaryExecutedNoScan:
        after.status === 'caught_up' || finalization?.noScanExecuted === true,`,
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
