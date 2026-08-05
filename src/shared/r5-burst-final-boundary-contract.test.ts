import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260804161000_xrpl_r5_finalize_burst_boundary.sql',
)
const trigger = read(
  'supabase/functions/xrpl-r5-recovery-batch-trigger/index.ts',
)
const adapter = read(
  'scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
)

describe('R5 burst final boundary contract', () => {
  it('drains only existing commit or finalize work and adopts exact descendants', () => {
    for (const required of [
      'create table if not exists xrpl_r5_v1.recovery_burst_finalizations',
      'public.xrpl_finalize_r5_recovery_burst_boundary(',
      "public.xrpl_drain_r5_checkpoint_boundary(",
      "onlyExistingCommitOrFinalizeDrained",
      "noScanExecuted",
      "onePendingScan",
      "pendingScanBoundToWatermark",
      "noInflightWork",
      'public.xrpl_adopt_r5_committed_active_descendants(',
      "v_leased_batch_count <> 0",
      "v_halted_batch_count <> 0",
      "v_last_batch_end <> v_run_after.current_watermark_ledger_index",
      "revoke all on function public.xrpl_finalize_r5_recovery_burst_boundary(",
      ') to service_role;',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('repairs only the observed four-ledger finalize boundary', () => {
    for (const required of [
      'v_run.completed_batches = 108',
      'v_run.committed_ledgers = 2256',
      'v_run.current_watermark_ledger_index = 4135563',
      'v_watermark.ledger_index = 4135567',
      'v_pending_count = 1',
      'v_finalize_count = 1',
      'v_inflight_count = 1',
      '30925522885',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('adds an authenticated finalization-only trigger mode without a ledger scan', () => {
    for (const required of [
      "mode !== 'execute_batch' && mode !== 'finalize_boundary'",
      "mode === 'finalize_boundary'",
      '/rest/v1/rpc/xrpl_finalize_r5_recovery_burst_boundary',
      'p_source_run_id: sourceRunId',
      'p_owner: `r5-burst-finalize-${sourceRunId}`',
      "resultField = 'finalization'",
      "noLedgerScanInFinalizationMode: mode === 'finalize_boundary'",
      'serviceKeyNotReturned: true',
    ]) {
      expect(trigger).toContain(required)
    }

    const finalizationBlock = trigger.slice(
      trigger.indexOf("if (mode === 'finalize_boundary')"),
      trigger.indexOf('    } else {', trigger.indexOf("if (mode === 'finalize_boundary')")),
    )
    expect(finalizationBlock).toContain(
      '/rest/v1/rpc/xrpl_finalize_r5_recovery_burst_boundary',
    )
    expect(finalizationBlock).not.toContain(
      '/functions/v1/xrpl-r5-recovery-batch',
    )
  })

  it('finalizes and materializes adoption rows before final parity', () => {
    for (const required of [
      "'R5 zero-progress executor count result'",
      'executorBatchCount: 0,',
      "'R5 final boundary trigger helper'",
      "mode: 'finalize_boundary'",
      'source_run_id: sourceRunId',
      "trigger.noLedgerScanInFinalizationMode !== true",
      "'R5 final boundary execution'",
      'finalization = await invokeFinalizationTrigger()',
      'const finalizationCycle = await verifyCycle(',
      'finalizationCycle.executorBatchCount !== 0',
      "kind: 'final_boundary'",
      'current = finalizedRecovery',
      'currentAdoptions = finalizedAdoptions',
      "'R5 finalization evidence'",
      'finalBoundaryCompleted:',
      'finalBoundaryExecutedNoScan:',
    ]) {
      expect(adapter).toContain(required)
    }
  })

  it('generates a syntactically valid bounded controller', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          R5_RECOVERY_ADAPTER_VALIDATE_ONLY: '1',
        },
        encoding: 'utf8',
      },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  it('does not authorize cutover, Mainnet, stabilization, or soak', () => {
    for (const forbidden of [
      "MAINNET_ENABLED: 'true'",
      'publicReaderUnchanged: false',
      'mainnetDisabled: false',
      'stabilizationAuthorized: true',
      'soakAuthorized: true',
    ]) {
      expect(`${migration}\n${trigger}\n${adapter}`).not.toContain(forbidden)
    }
  })
})
