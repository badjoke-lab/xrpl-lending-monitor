import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import { normalizeCurrentState } from './normalize-current-state'
import {
  scanCurrentState,
  type CurrentStateScanResult,
} from './scan-current-state'

const runLive = process.env.RUN_LIVE_CURRENT_STATE_FULL_SCAN === 'true'
const endpoint =
  process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const artifactPath = 'artifacts/current-state-full-scan.json'

async function writeArtifact(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function errorField(error: unknown, field: string): unknown {
  if (typeof error !== 'object' || error === null || !(field in error)) return null
  return (error as Record<string, unknown>)[field] ?? null
}

describe.runIf(runLive)('live current-state full scan', () => {
  it('completes one binary ledger pass and validates all current projections', async () => {
    const snapshot = await readNetworkSnapshot({
      endpoints: [endpoint],
      timeoutMs: 20_000,
    })
    const startedAt = Date.now()
    const heapBefore = process.memoryUsage().heapUsed
    let scan: CurrentStateScanResult | undefined

    try {
      scan = await scanCurrentState({
        endpoint: snapshot.endpoint,
        timeoutMs: 20_000,
        ledgerHash: snapshot.validatedLedger.hash,
        ledgerIndex: snapshot.validatedLedger.index,
        pageLimitPerType: 20_000,
        requestLimitTotal: 20_000,
        objectLimitPerPage: 2_048,
      })
      const heapAfterScan = process.memoryUsage().heapUsed
      const normalized = normalizeCurrentState(scan, { failOnIntegrityIssues: false })
      const heapAfterNormalization = process.memoryUsage().heapUsed

      const artifact = {
        schema_version: 1,
        complete: true,
        observed_at: snapshot.observedAt,
        endpoint: snapshot.endpoint,
        network: snapshot.network,
        ledger: {
          index: snapshot.validatedLedger.index,
          hash: snapshot.validatedLedger.hash,
          age_seconds: snapshot.validatedLedger.ageSeconds,
        },
        amendments: {
          lending_protocol: snapshot.amendments.lendingProtocol,
          single_asset_vault: snapshot.amendments.singleAssetVault,
        },
        metrics: scan.metrics,
        normalized_counts: {
          vaults: normalized.vaults.length,
          loan_brokers: normalized.loanBrokers.length,
          loans: normalized.loans.length,
        },
        integrity: {
          issue_count: normalized.integrityIssues.length,
          issue_counts_by_code: Object.fromEntries(
            [...new Set(normalized.integrityIssues.map((issue) => issue.code))].map((code) => [
              code,
              normalized.integrityIssues.filter((issue) => issue.code === code).length,
            ]),
          ),
          sample: normalized.integrityIssues.slice(0, 20),
        },
        wall_time_ms: Date.now() - startedAt,
        process_heap_before_bytes: heapBefore,
        process_heap_after_scan_bytes: heapAfterScan,
        process_heap_after_normalization_bytes: heapAfterNormalization,
        process_heap_scan_delta_bytes: heapAfterScan - heapBefore,
        process_heap_total_delta_bytes: heapAfterNormalization - heapBefore,
      }

      await writeArtifact(artifact)
      console.info(`CURRENT_STATE_FULL_SCAN=${JSON.stringify(artifact)}`)
      expect(scan.metrics.pages).toBeGreaterThan(0)
      expect(scan.metrics.requests).toBe(scan.metrics.pages)
      expect(scan.metrics.objects).toBe(
        normalized.vaults.length + normalized.loanBrokers.length + normalized.loans.length,
      )
    } catch (error) {
      const artifact = {
        schema_version: 1,
        complete: false,
        observed_at: snapshot.observedAt,
        endpoint: snapshot.endpoint,
        network: snapshot.network,
        ledger: {
          index: snapshot.validatedLedger.index,
          hash: snapshot.validatedLedger.hash,
        },
        partial_metrics: scan?.metrics ?? null,
        wall_time_ms: Date.now() - startedAt,
        process_heap_delta_bytes: process.memoryUsage().heapUsed - heapBefore,
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          pages_completed: errorField(error, 'pagesCompleted'),
          requests_completed: errorField(error, 'requestsCompleted'),
          decoded_objects: errorField(error, 'decodedObjects'),
          relevant_objects: errorField(error, 'relevantObjects'),
          last_marker: errorField(error, 'lastMarker'),
          issues: errorField(error, 'issues'),
        },
      }
      await writeArtifact(artifact)
      console.error(`CURRENT_STATE_FULL_SCAN_FAILURE=${JSON.stringify(artifact)}`)
      throw error
    }
  }, 1_200_000)
})
