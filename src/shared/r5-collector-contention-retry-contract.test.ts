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

function exactBody(overrides: Record<string, unknown> = {}) {
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
        'xrpl_claim_r5_active_recovery_batch_from_prepared_head failed: r5_checkpoint_drain_collector_not_quiescent',
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
  it('classifies only the exact no-mutation collector contention response', () => {
    expect(isRetryableR5CollectorContention(500, exactBody())).toBe(true)

    for (const body of [
      exactBody({ operationMode: 'finalize_boundary' }),
      exactBody({ executor: { ...exactBody().executor, batchId: 'r5-batch' } }),
      exactBody({ executor: { ...exactBody().executor, activeMutationCommitted: true } }),
      exactBody({ executor: { ...exactBody().executor, transient: true } }),
      exactBody({ executor: { ...exactBody().executor, error: 'other_error' } }),
    ]) {
      expect(isRetryableR5CollectorContention(500, body)).toBe(false)
    }
    expect(isRetryableR5CollectorContention(503, exactBody())).toBe(false)
  })

  it('rewrites only the trigger response and preserves the 500 status', async () => {
    const response = new Response(JSON.stringify(exactBody()), {
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
    expect(body.retryClassification).toBe('collector_contention_without_mutation')
  })

  it('does not rewrite unrelated trigger failures', async () => {
    const body = exactBody({
      executor: { ...exactBody().executor, error: 'revision3_resource_halt' },
    })
    const response = new Response(JSON.stringify(body), { status: 500 })
    const retained = await rewriteR5CollectorContentionResponse(
      'https://example.supabase.co/functions/v1/xrpl-r5-recovery-batch-trigger',
      response,
    )
    expect(await retained.json()).toEqual(body)
  })

  it('retains the existing three-attempt sixty-second bounded retry', () => {
    expect(controller).toContain('const maximumAttemptsPerTrigger = 3')
    expect(controller).toContain('const retryDelayMilliseconds = 60_000')
    expect(wrapper).toContain('rewriteR5CollectorContentionResponse')
    expect(wrapper).toContain("await import('./run-supabase-r5-recovery-burst-adoption-aware.mjs')")
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
