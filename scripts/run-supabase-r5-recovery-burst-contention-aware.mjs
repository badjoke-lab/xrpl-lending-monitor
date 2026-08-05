import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const sourcePath = 'scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs'
const generatedRunnerPath = `/tmp/xrpl-r5-recovery-burst-generated-preclaim-${process.pid}.mjs`
const insertionPoint =
  "await writeFile(generatedPath, generated, { encoding: 'utf8', mode: 0o600 })"

const directGeneratedControllerPatch = String.raw`
const matcherSourcePath = 'scripts/r5-preclaim-watermark-drift-match.mjs'
const matcherSource = await readFile(matcherSourcePath, 'utf8')
const matcherExport = 'export function isExactUncommittedWatermarkDriftFailure(error) {'
if (
  matcherSource.split(matcherExport).length - 1 !== 1
  || matcherSource.includes('import ')
  || matcherSource.match(/export /g)?.length !== 1
) {
  throw new Error('R5 generated preclaim matcher source boundary changed')
}
const embeddedMatcher = matcherSource.replace(
  matcherExport,
  'function isExactUncommittedWatermarkDriftFailure(error) {',
)
if (
  embeddedMatcher === matcherSource
  || embeddedMatcher.includes('export ')
  || !embeddedMatcher.includes('function isExactUncommittedWatermarkDriftFailure(error) {')
) {
  throw new Error('R5 generated preclaim matcher embedding did not converge')
}

const embeddedCollectorContentionMatcher = [
  "const r5CollectorContentionError = 'r5_checkpoint_drain_collector_not_quiescent'",
  '',
  'function isExactUncommittedCollectorContentionFailure(error) {',
  '  const body = error?.response',
  '  const executor = body?.executor',
  "  return error?.name === 'TriggerError'",
  '    && error?.transient === false',
  "    && typeof error?.message === 'string'",
  "    && error.message.startsWith('R5 trigger failed (500): ')",
  '    && body?.schemaVersion === 1',
  "    && body?.purpose === 'r5-first-active-recovery-batch'",
  "    && body?.operationMode === 'execute_batch'",
  '    && executor?.activeMutationCommitted === false',
  '    && executor?.batchId === null',
  '    && executor?.transient === false',
  "    && typeof executor?.error === 'string'",
  '    && executor.error.includes(r5CollectorContentionError)',
  '}',
].join('\n')

replaceExactlyOnce(
  'R5 generated preclaim matcher installation',
  [
    "const retryableDeclineReasons = new Set(['batch_lease_active', 'not_claimed'])",
    '',
    'class TriggerError extends Error {',
  ].join('\n'),
  [
    "const retryableDeclineReasons = new Set(['batch_lease_active', 'not_claimed'])",
    '',
    embeddedMatcher.trimEnd(),
    '',
    embeddedCollectorContentionMatcher,
    '',
    'let preclaimFinalizationUsed = false',
    '',
    'class TriggerError extends Error {',
  ].join('\n'),
)

replaceExactlyOnce(
  'R5 generated preclaim finalization and retry',
  [
    '    try {',
    '      lastTrigger = await invokeTrigger()',
    '    } catch (error) {',
    '      if (!(error instanceof TriggerError) || error.transient !== true) throw error',
    '      transientRetries += 1',
    '      lastTrigger = error.response',
    '    }',
  ].join('\n'),
  [
    '    try {',
    '      lastTrigger = await invokeTrigger()',
    '    } catch (error) {',
    '      if (',
    '        !preclaimFinalizationUsed',
    '        && error instanceof TriggerError',
    '        && isExactUncommittedWatermarkDriftFailure(error)',
    '      ) {',
    '        preclaimFinalizationUsed = true',
    '        const preclaimFinalization = await invokeFinalizationTrigger()',
    '        console.log(JSON.stringify({',
    "          event: 'r5_preclaim_watermark_drift_finalized',",
    '          sourceRunId: preclaimFinalization.sourceRunId,',
    '          currentWatermarkLedgerIndex:',
    '            preclaimFinalization.currentWatermarkLedgerIndex,',
    '          drainedStepCount: preclaimFinalization.drainedStepCount,',
    '          noScanExecuted: true,',
    '          publicReaderUnchanged: true,',
    '          mainnetDisabled: true,',
    '          stabilizationAuthorized: false,',
    '          soakAuthorized: false,',
    '        }))',
    '        lastTrigger = await invokeTrigger()',
    '      } else if (',
    '        error instanceof TriggerError',
    '        && isExactUncommittedCollectorContentionFailure(error)',
    '      ) {',
    '        transientRetries += 1',
    '        lastTrigger = error.response',
    '      } else {',
    '        if (!(error instanceof TriggerError) || error.transient !== true) throw error',
    '        transientRetries += 1',
    '        lastTrigger = error.response',
    '      }',
    '    }',
  ].join('\n'),
)
`

const source = await readFile(sourcePath, 'utf8')
const insertionCount = source.split(insertionPoint).length - 1
if (insertionCount !== 1) {
  throw new Error(
    `R5 generated-controller patch expected one write boundary, found ${insertionCount}`,
  )
}
if (source.includes('R5 generated preclaim matcher installation')) {
  throw new Error('R5 generated-controller patch is already present in source')
}
const generatedRunner = source.replace(
  insertionPoint,
  `${directGeneratedControllerPatch}\n${insertionPoint}`,
)
if (
  generatedRunner === source
  || generatedRunner.includes(`${insertionPoint}\n${insertionPoint}`)
  || !generatedRunner.includes('R5 generated preclaim finalization and retry')
) {
  throw new Error('R5 generated-controller patch did not converge exactly')
}

await writeFile(generatedRunnerPath, generatedRunner, {
  encoding: 'utf8',
  mode: 0o600,
})
try {
  await import(pathToFileURL(generatedRunnerPath).href)
} finally {
  await rm(generatedRunnerPath, { force: true })
}
