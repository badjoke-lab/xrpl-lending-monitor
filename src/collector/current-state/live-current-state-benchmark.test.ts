import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import {
  CurrentStateScanError,
  scanCurrentState,
} from './scan-current-state'

const runLive = process.env.RUN_LIVE_CURRENT_STATE_BENCHMARK === 'true'
const endpoint =
  process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const artifactPath = 'artifacts/current-state-live-benchmark.json'
const probePages = 25
const requestedObjectsPerPage = 2_048

async function writeArtifact(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

describe.runIf(runLive)('live current-state benchmark', () => {
  it('records bounded single-pass binary traversal evidence', async () => {
    const snapshot = await readNetworkSnapshot({
      endpoints: [endpoint],
      timeoutMs: 15_000,
    })
    const heapBefore = process.memoryUsage().heapUsed
    const startedAt = Date.now()

    let result:
      | {
          complete: true
          pages: number
          requests: number
          decoded_objects: number
          relevant_objects: number
          by_type: Record<string, { objects: number }>
          last_marker: null
        }
      | {
          complete: false
          pages: number
          requests: number
          decoded_objects: number
          relevant_objects: number
          by_type: null
          last_marker: unknown
        }

    try {
      const scan = await scanCurrentState({
        endpoint: snapshot.endpoint,
        timeoutMs: 15_000,
        ledgerHash: snapshot.validatedLedger.hash,
        ledgerIndex: snapshot.validatedLedger.index,
        pageLimitPerType: probePages,
        requestLimitTotal: probePages,
        objectLimitPerPage: requestedObjectsPerPage,
      })
      result = {
        complete: true,
        pages: scan.metrics.pages,
        requests: scan.metrics.requests,
        decoded_objects: scan.metrics.decodedObjects,
        relevant_objects: scan.metrics.objects,
        by_type: scan.metrics.byType,
        last_marker: null,
      }
    } catch (error) {
      if (
        !(error instanceof CurrentStateScanError) ||
        !error.message.includes(`page limit ${probePages} reached before completion`)
      ) {
        throw error
      }
      result = {
        complete: false,
        pages: error.pagesCompleted,
        requests: error.requestsCompleted,
        decoded_objects: error.decodedObjects,
        relevant_objects: error.relevantObjects,
        by_type: null,
        last_marker: error.lastMarker,
      }
    }

    const heapAfter = process.memoryUsage().heapUsed
    const artifact = {
      schema_version: 3,
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
      probe_configuration: {
        response_mode: 'binary',
        traversal: 'single_pass_unfiltered',
        pages: probePages,
        requested_objects_per_page: requestedObjectsPerPage,
      },
      result,
      elapsed_ms: Date.now() - startedAt,
      average_decoded_objects_per_page:
        result.pages === 0 ? 0 : result.decoded_objects / result.pages,
      relevant_ratio:
        result.decoded_objects === 0
          ? 0
          : result.relevant_objects / result.decoded_objects,
      process_heap_delta_bytes: heapAfter - heapBefore,
      full_scan_attempted: false,
    }

    await writeArtifact(artifact)
    console.info(`CURRENT_STATE_BENCHMARK=${JSON.stringify(artifact)}`)
    expect(result.pages).toBeGreaterThan(0)
    expect(result.decoded_objects).toBeGreaterThan(0)
    expect(result.relevant_objects).toBeGreaterThanOrEqual(0)
  }, 180_000)
})
