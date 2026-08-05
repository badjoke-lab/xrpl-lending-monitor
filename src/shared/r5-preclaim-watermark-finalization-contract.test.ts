import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const source = read('scripts/run-supabase-r5-recovery-burst-contention-aware.mjs')
const matcher = read('scripts/r5-preclaim-watermark-drift-match.mjs')

describe('R5 preclaim watermark-drift finalization', () => {
  it('matches only the exact response-side uncommitted claim drift', () => {
    for (const required of [
      "const exactWatermarkDrift = 'r5_recovery_batch_watermark_drift'",
      'response?.status === 500',
      'body?.schemaVersion === 1',
      "body?.operationMode === 'execute_batch'",
      'executor?.ok === false',
      'executor?.transient === false',
      "executor?.runId === recoveryRunId",
      'executor?.batchId === null',
      'executor?.activeMutationCommitted === false',
      'executor.error.includes(exactWatermarkDrift)',
    ]) {
      expect(matcher).toContain(required)
    }
    expect(source).toContain('url.includes(triggerPath)')
    expect(source).toContain(
      'isExactUncommittedWatermarkDrift(response, responseBody)',
    )
    expect(source).not.toContain('requestBody?.run_id')
    expect(source).not.toContain('parseObjectBody')
  })

  it('runs the correction at most once in one controller process', () => {
    expect(source).toContain('let preclaimFinalizationUsed = false')
    expect(source).toContain('!preclaimFinalizationUsed')
    expect(source).toContain('preclaimFinalizationUsed = true')
    expect(source.match(/preclaimFinalizationUsed = true/g)).toHaveLength(1)
  })

  it('uses the existing finalization mode without a ledger scan', () => {
    for (const required of [
      "source: 'github_actions'",
      'run_id: recoveryRunId',
      "mode: 'finalize_boundary'",
      'source_run_id: exactPositiveRunId()',
      'signal: AbortSignal.timeout(90_000)',
      "finalizationBody?.operationMode !== 'finalize_boundary'",
      'finalization?.finalized !== true',
      'finalization?.runId !== recoveryRunId',
      'finalization?.noScanExecuted !== true',
      'trigger?.noLedgerScanInFinalizationMode !== true',
    ]) {
      expect(source).toContain(required)
    }
  })

  it('keeps reader, network, and release boundaries fail closed', () => {
    for (const required of [
      'finalization?.publicReaderUnchanged !== true',
      'finalization?.mainnetDisabled !== true',
      'finalization?.stabilizationAuthorized !== false',
      'finalization?.soakAuthorized !== false',
      'trigger?.combinedProxyBytesWithinFixedReserve !== true',
      'trigger?.twoInvocationReservationUsed !== true',
      'trigger?.serviceKeyNotReturned !== true',
      "throw new Error(\n      `R5 preclaim finalization failed closed:",
    ]) {
      expect(source).toContain(required)
    }
  })

  it('finalizes before retrying the unchanged original claim exactly once', () => {
    const finalizeIndex = source.indexOf(
      'await finalizeBoundaryBeforeClaim(input, init)',
    )
    const retryIndex = source.indexOf(
      'const retriedResponse = await originalFetch(input, init)',
    )
    expect(finalizeIndex).toBeGreaterThan(-1)
    expect(retryIndex).toBeGreaterThan(finalizeIndex)
    expect(source.match(/const retriedResponse = await originalFetch\(input, init\)/g))
      .toHaveLength(1)
    expect(source).toContain(
      'return rewriteR5CollectorContentionResponse(url, retriedResponse)',
    )
  })

  it('emits sanitized proof and restores global fetch', () => {
    for (const required of [
      "event: 'r5_preclaim_watermark_drift_finalized'",
      'currentWatermarkLedgerIndex: finalization.currentWatermarkLedgerIndex',
      'drainedStepCount: finalization.drainedStepCount',
      'noScanExecuted: true',
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
      "await import('./run-supabase-r5-recovery-burst-adoption-aware.mjs')",
      'globalThis.fetch = originalFetch',
    ]) {
      expect(source).toContain(required)
    }
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(source).not.toContain('MAINNET_ENABLED')
  })
})
