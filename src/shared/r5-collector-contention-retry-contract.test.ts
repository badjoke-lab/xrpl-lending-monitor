import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isRetryableR5CollectorContention,
  rewriteR5CollectorContentionResponse,
} from '../../scripts/r5-collector-contention-retry.mjs'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const workflow = read('.github/workflows/r5-bounded-recovery-burst.yml')
const wrapper = read('scripts/run-supabase-r5-recovery-burst-contention-aware.mjs')
const controller = read('scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs')

const checkpointContention = 'r5_checkpoint_drain_collector_not_quiescent'
const recoveryContention = 'r5_recovery_batch_collector_not_quiescent'

function exactBody(
  exactError = checkpointContention,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    purpose: 'r5-first-active-recovery-batch',
    operationMode: 'execute_batch',
    executor: {
      ok: false,
      transient: false,
      runId: 'r5-recovery-selected-revision3-entry',
      batchId: null,
      error:
        `xrpl_claim_r5_active_recovery_batch_from_prepared_head failed: ${exactError}`,
      activeMutationCommitted: false,
    },
    trigger: {
      combinedProxyBytesWithinFixedReserve: true,
      twoInvocationReservationUsed: true,
      serviceKeyNotReturned: true,
    },
    ...overrides,
  }
}

describe('R5 collector contention bounded retry contract', () => {
  it.each([checkpointContention, recoveryContention])(
    'classifies the exact no-mutation collector contention %s',
    (exactError) => {
      expect(isRetryableR5CollectorContention(500, exactBody(exactError))).toBe(
        true,
      )
    },
  )

  it('rejects changed mutation, response, and error boundaries', () => {
    for (const body of [
      exactBody(checkpointContention, { operationMode: 'finalize_boundary' }),
      exactBody(checkpointContention, {
        executor: { ...exactBody().executor, batchId: 'r5-batch' },
      }),
      exactBody(checkpointContention, {
        executor: { ...exactBody().executor, activeMutationCommitted: true },
      }),
      exactBody(checkpointContention, {
        executor: { ...exactBody().executor, transient: true },
      }),
      exactBody('other_error'),
    ]) {
      expect(isRetryableR5CollectorContention(500, body)).toBe(false)
    }
    expect(isRetryableR5CollectorContention(503, exactBody())).toBe(false)
  })

  it('rewrites both exact trigger responses and preserves the 500 status', async () => {
    for (const exactError of [checkpointContention, recoveryContention]) {
      const response = new Response(JSON.stringify(exactBody(exactError)), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
      const rewritten = await rewriteR5CollectorContentionResponse(
        'https://example.supabase.co/functions/v1/xrpl-r5-recovery-batch-trigger',
        response,
      )
      const body = await rewritten.json()
      expect(rewritten.status).toBe(500)
      expect(body.executor.transient).toBe(true)
      expect(body.executor.activeMutationCommitted).toBe(false)
      expect(body.executor.batchId).toBeNull()
      expect(body.retryClassification).toBe(
        'collector_contention_without_mutation',
      )
    }
  })

  it('does not rewrite unrelated trigger failures', async () => {
    const body = exactBody('revision3_resource_halt')
    const response = new Response(JSON.stringify(body), { status: 500 })
    const retained = await rewriteR5CollectorContentionResponse(
      'https://example.supabase.co/functions/v1/xrpl-r5-recovery-batch-trigger',
      response,
    )
    expect(await retained.json()).toEqual(body)
  })

  it('retains the existing three-attempt sixty-second bounded retry in the generated controller', () => {
    expect(controller).toContain('const maximumAttemptsPerTrigger = 3')
    expect(controller).toContain('const retryDelayMilliseconds = 60_000')
    for (const required of [
      'const r5CollectorContentionErrors = new Set([',
      "'r5_checkpoint_drain_collector_not_quiescent'",
      "'r5_recovery_batch_collector_not_quiescent'",
      'function isExactUncommittedCollectorContentionFailure(error) {',
      "error.message.startsWith('R5 trigger failed (500): ')",
      'executor?.activeMutationCommitted === false',
      'executor?.batchId === null',
      'executor?.transient === false',
      '[...r5CollectorContentionErrors].some((exactError) =>',
      'executor.error.includes(exactError)',
      '&& isExactUncommittedCollectorContentionFailure(error)',
      'transientRetries += 1',
      'lastTrigger = error.response',
      "const sourcePath = 'scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs'",
      'await import(pathToFileURL(generatedRunnerPath).href)',
    ]) {
      expect(wrapper).toContain(required)
    }
    expect(workflow).toContain(
      'run: node scripts/run-supabase-r5-recovery-burst-contention-aware.mjs',
    )
    expect(workflow).toContain(
      '# node scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
    )
  })

  it('does not broaden workflow or release boundaries', () => {
    for (const forbidden of [
      '  schedule:',
      'contents: write',
      "MAINNET_ENABLED: 'true'",
      'stabilizationAuthorized: true',
      'soakAuthorized: true',
    ]) {
      expect(`${workflow}\n${wrapper}`).not.toContain(forbidden)
    }
  })
})
