import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import { scanCurrentState } from './scan-current-state'

const runLive = process.env.RUN_LIVE_CURRENT_STATE_BENCHMARK === 'true'
const endpoint =
  process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'

function fieldNames(value: Record<string, unknown> | undefined): string[] {
  return value ? Object.keys(value).sort() : []
}

describe.runIf(runLive)('live current-state benchmark', () => {
  it('reads one validated Devnet snapshot and completes every marker chain', async () => {
    const snapshot = await readNetworkSnapshot({
      endpoints: [endpoint],
      timeoutMs: 15_000,
    })
    const heapBefore = process.memoryUsage().heapUsed
    const scan = await scanCurrentState({
      endpoint: snapshot.endpoint,
      timeoutMs: 15_000,
      ledgerHash: snapshot.validatedLedger.hash,
      ledgerIndex: snapshot.validatedLedger.index,
      pageLimitPerType: 200,
      requestLimitTotal: 600,
    })
    const heapAfter = process.memoryUsage().heapUsed

    const artifact = {
      schema_version: 1,
      observed_at: snapshot.observedAt,
      network: snapshot.network,
      endpoint: snapshot.endpoint,
      ledger: {
        index: snapshot.validatedLedger.index,
        hash: snapshot.validatedLedger.hash,
        age_seconds: snapshot.validatedLedger.ageSeconds,
      },
      amendments: {
        lending_protocol: snapshot.amendments.lendingProtocol,
        single_asset_vault: snapshot.amendments.singleAssetVault,
      },
      counts: {
        vaults: scan.vaults.length,
        loan_brokers: scan.loanBrokers.length,
        loans: scan.loans.length,
      },
      metrics: scan.metrics,
      sample_field_names: {
        vault: fieldNames(scan.vaults[0]),
        loan_broker: fieldNames(scan.loanBrokers[0]),
        loan: fieldNames(scan.loans[0]),
      },
      process_heap_delta_bytes: heapAfter - heapBefore,
      complete: true,
    }

    await mkdir('artifacts', { recursive: true })
    await writeFile(
      'artifacts/current-state-live-benchmark.json',
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    )

    console.info(`CURRENT_STATE_BENCHMARK=${JSON.stringify(artifact)}`)
    expect(scan.metrics.requests).toBeGreaterThanOrEqual(3)
    expect(scan.metrics.pages).toBeGreaterThanOrEqual(3)
    expect(scan.metrics.objects).toBe(
      scan.vaults.length + scan.loanBrokers.length + scan.loans.length,
    )
  }, 120_000)
})
