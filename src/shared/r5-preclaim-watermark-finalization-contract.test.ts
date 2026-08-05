import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const wrapper = read('scripts/run-supabase-r5-recovery-burst-contention-aware.mjs')
const adoptionRunner = read(
  'scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
)
const matcher = read('scripts/r5-preclaim-watermark-drift-match.mjs')

describe('R5 generated-controller preclaim finalization', () => {
  it('matches only the exact non-transient TriggerError from production', () => {
    for (const required of [
      "const r5PreclaimExactWatermarkDrift = 'r5_recovery_batch_watermark_drift'",
      "error?.name === 'TriggerError'",
      'error?.transient === false',
      "error.message.startsWith('R5 trigger failed (500): ')",
      'body?.schemaVersion === 1',
      "body?.operationMode === 'execute_batch'",
      'executor?.ok === false',
      'executor?.transient === false',
      'executor?.batchId === null',
      'executor?.activeMutationCommitted === false',
      'executor.error.includes(r5PreclaimExactWatermarkDrift)',
    ]) {
      expect(matcher).toContain(required)
    }
  })

  it('embeds the pure matcher into the generated verifier exactly once', () => {
    for (const required of [
      "const matcherSourcePath = 'scripts/r5-preclaim-watermark-drift-match.mjs'",
      "const matcherExport = 'export function isExactUncommittedWatermarkDriftFailure(error) {'",
      "matcherSource.includes('import ')",
      'matcherSource.match(/export /g)?.length !== 1',
      'embeddedMatcher.includes(\'export \')',
      'R5 generated preclaim matcher installation',
      'replaceExactlyOnce(',
      'let preclaimFinalizationUsed = false',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('catches the generated TriggerError, finalizes, and retries one unchanged claim', () => {
    const matchIndex = wrapper.indexOf(
      '&& isExactUncommittedWatermarkDriftFailure(error)',
    )
    const finalizeIndex = wrapper.indexOf(
      'const preclaimFinalization = await invokeFinalizationTrigger()',
    )
    const retryIndex = wrapper.indexOf('lastTrigger = await invokeTrigger()', finalizeIndex)

    expect(matchIndex).toBeGreaterThan(-1)
    expect(finalizeIndex).toBeGreaterThan(matchIndex)
    expect(retryIndex).toBeGreaterThan(finalizeIndex)
    expect(wrapper).toContain('!preclaimFinalizationUsed')
    expect(wrapper).toContain('preclaimFinalizationUsed = true')
    expect(wrapper.match(/preclaimFinalizationUsed = true/g)).toHaveLength(1)
    expect(wrapper.match(/const preclaimFinalization = await invokeFinalizationTrigger\(\)/g))
      .toHaveLength(1)
  })

  it('uses the existing exact no-scan finalization implementation', () => {
    for (const required of [
      'async function invokeFinalizationTrigger()',
      "mode: 'finalize_boundary'",
      'source_run_id: sourceRunId',
      'signal: AbortSignal.timeout(90_000)',
      "body.operationMode !== 'finalize_boundary'",
      'trigger.noLedgerScanInFinalizationMode !== true',
      'finalization.finalized !== true',
      'finalization.noScanExecuted !== true',
      'finalization.publicReaderUnchanged !== true',
      'finalization.mainnetDisabled !== true',
      'finalization.stabilizationAuthorized !== false',
      'finalization.soakAuthorized !== false',
    ]) {
      expect(adoptionRunner).toContain(required)
    }
  })

  it('emits sanitized proof from inside the generated verifier', () => {
    for (const required of [
      "event: 'r5_preclaim_watermark_drift_finalized'",
      'sourceRunId: preclaimFinalization.sourceRunId',
      'preclaimFinalization.currentWatermarkLedgerIndex',
      'drainedStepCount: preclaimFinalization.drainedStepCount',
      'noScanExecuted: true',
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('removes the ineffective outer fetch hook', () => {
    expect(wrapper).not.toContain('globalThis.fetch')
    expect(wrapper).not.toContain('rewriteR5CollectorContentionResponse')
    expect(wrapper).not.toContain('originalFetch')
    expect(wrapper).toContain('R5 generated-controller patch expected one write boundary')
    expect(wrapper).toContain('await import(pathToFileURL(generatedRunnerPath).href)')
    expect(wrapper).toContain('await rm(generatedRunnerPath, { force: true })')
  })

  it('retains generated-controller syntax validation', () => {
    expect(adoptionRunner).toContain("process.env.R5_RECOVERY_ADAPTER_VALIDATE_ONLY === '1'")
    expect(adoptionRunner).toContain("spawnSync(process.execPath, ['--check', generatedPath]")
  })

  it('does not expose service credentials or enable Mainnet', () => {
    expect(wrapper).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(wrapper).not.toContain('MAINNET_ENABLED')
    expect(matcher).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(matcher).not.toContain('MAINNET_ENABLED')
  })
})
