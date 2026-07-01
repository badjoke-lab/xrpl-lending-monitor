import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import {
  scanLedgerObjects,
  type CurrentObjectFilter,
} from './scan-ledger-objects'

const runLive = process.env.RUN_LIVE_CURRENT_TYPE_FULL_SCAN === 'true'
const endpoint =
  process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const filter = process.env.CURRENT_STATE_FILTER as CurrentObjectFilter | undefined

function isFilter(value: unknown): value is CurrentObjectFilter {
  return value === 'vault' || value === 'loan_broker' || value === 'loan'
}

async function writeArtifact(name: string, value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(`artifacts/${name}.json`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

describe.runIf(runLive)('live current object full scan', () => {
  it('completes one binary marker chain for the selected object type', async () => {
    if (!isFilter(filter)) throw new Error('CURRENT_STATE_FILTER is invalid')

    const snapshot = await readNetworkSnapshot({
      endpoints: [endpoint],
      timeoutMs: 20_000,
    })
    const heapBefore = process.memoryUsage().heapUsed
    const startedAt = Date.now()

    try {
      const scan = await scanLedgerObjects({
        endpoint: snapshot.endpoint,
        timeoutMs: 20_000,
        ledgerHash: snapshot.validatedLedger.hash,
        ledgerIndex: snapshot.validatedLedger.index,
        filter,
        pageLimit: 20_000,
        requestLimit: 20_000,
        objectLimitPerPage: 2_048,
      })
      const heapAfter = process.memoryUsage().heapUsed
      const artifact = {
        schema_version: 1,
        complete: true,
        observed_at: snapshot.observedAt,
        endpoint: snapshot.endpoint,
        network: snapshot.network,
        filter,
        ledger: {
          index: snapshot.validatedLedger.index,
          hash: snapshot.validatedLedger.hash,
          age_seconds: snapshot.validatedLedger.ageSeconds,
        },
        metrics: scan.metrics,
        wall_time_ms: Date.now() - startedAt,
        process_heap_before_bytes: heapBefore,
        process_heap_after_bytes: heapAfter,
        process_heap_delta_bytes: heapAfter - heapBefore,
      }
      await writeArtifact(`current-state-full-scan-${filter}`, artifact)
      console.info(`CURRENT_STATE_FULL_SCAN=${JSON.stringify(artifact)}`)
      expect(scan.metrics.pages).toBeGreaterThan(0)
      expect(scan.metrics.requests).toBe(scan.metrics.pages)
    } catch (error) {
      const artifact = {
        schema_version: 1,
        complete: false,
        observed_at: snapshot.observedAt,
        endpoint: snapshot.endpoint,
        network: snapshot.network,
        filter,
        ledger: {
          index: snapshot.validatedLedger.index,
          hash: snapshot.validatedLedger.hash,
        },
        wall_time_ms: Date.now() - startedAt,
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          pages_completed:
            typeof error === 'object' && error !== null && 'pagesCompleted' in error
              ? (error as { pagesCompleted?: unknown }).pagesCompleted ?? null
              : null,
          objects_read:
            typeof error === 'object' && error !== null && 'objectsRead' in error
              ? (error as { objectsRead?: unknown }).objectsRead ?? null
              : null,
          last_marker:
            typeof error === 'object' && error !== null && 'lastMarker' in error
              ? (error as { lastMarker?: unknown }).lastMarker ?? null
              : null,
        },
      }
      await writeArtifact(`current-state-full-scan-${filter}`, artifact)
      console.error(`CURRENT_STATE_FULL_SCAN_FAILURE=${JSON.stringify(artifact)}`)
      throw error
    }
  }, 1_200_000)
})
