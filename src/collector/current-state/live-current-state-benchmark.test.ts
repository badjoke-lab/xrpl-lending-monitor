import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import { scanCurrentState } from './scan-current-state'

const runLive = process.env.RUN_LIVE_CURRENT_STATE_BENCHMARK === 'true'
const endpoint =
  process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const artifactPath = 'artifacts/current-state-live-benchmark.json'

function fieldNames(value: Record<string, unknown> | undefined): string[] {
  return value ? Object.keys(value).sort() : []
}

async function writeArtifact(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function errorArtifact(error: unknown): Record<string, unknown> {
  return {
    schema_version: 1,
    observed_at: new Date().toISOString(),
    endpoint,
    complete: false,
    error: {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      details:
        typeof error === 'object' && error !== null && 'details' in error
          ? (error as { details?: unknown }).details ?? null
          : null,
      failures:
        typeof error === 'object' && error !== null && 'failures' in error
          ? (error as { failures?: unknown }).failures ?? null
          : null,
    },
  }
}

describe.runIf(runLive)('live current-state benchmark', () => {
  it('reads one validated Devnet snapshot and completes every marker chain', async () => {
    try {
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

      await writeArtifact(artifact)
      console.info(`CURRENT_STATE_BENCHMARK=${JSON.stringify(artifact)}`)
      expect(scan.metrics.requests).toBeGreaterThanOrEqual(3)
      expect(scan.metrics.pages).toBeGreaterThanOrEqual(3)
      expect(scan.metrics.objects).toBe(
        scan.vaults.length + scan.loanBrokers.length + scan.loans.length,
      )
    } catch (error) {
      const artifact = errorArtifact(error)
      await writeArtifact(artifact)
      console.error(`CURRENT_STATE_BENCHMARK_FAILURE=${JSON.stringify(artifact)}`)
      throw error
    }
  }, 120_000)
})
