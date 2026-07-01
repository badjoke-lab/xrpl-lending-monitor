import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import {
  LedgerObjectScanError,
  scanLedgerObjects,
  type CurrentObjectFilter,
} from './scan-ledger-objects'

const runLive = process.env.RUN_LIVE_CURRENT_STATE_BENCHMARK === 'true'
const endpoint =
  process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const artifactPath = 'artifacts/current-state-live-benchmark.json'
const probePagesPerType = 25
const requestedObjectsPerPage = 2_048

async function writeArtifact(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

interface ProbeResult {
  filter: CurrentObjectFilter
  complete: boolean
  pages: number
  requests: number
  objects: number
  elapsed_ms: number
  average_objects_per_page: number
  requested_objects_per_page: number
  last_marker: unknown
}

async function probeType(options: {
  filter: CurrentObjectFilter
  endpoint: string
  ledgerHash: string
  ledgerIndex: number
}): Promise<ProbeResult> {
  const startedAt = Date.now()

  try {
    const result = await scanLedgerObjects({
      endpoint: options.endpoint,
      timeoutMs: 15_000,
      ledgerHash: options.ledgerHash,
      ledgerIndex: options.ledgerIndex,
      filter: options.filter,
      pageLimit: probePagesPerType,
      requestLimit: probePagesPerType,
      objectLimitPerPage: requestedObjectsPerPage,
    })

    return {
      filter: options.filter,
      complete: true,
      pages: result.metrics.pages,
      requests: result.metrics.requests,
      objects: result.metrics.objects,
      elapsed_ms: result.metrics.elapsedMs,
      average_objects_per_page:
        result.metrics.pages === 0 ? 0 : result.metrics.objects / result.metrics.pages,
      requested_objects_per_page: result.metrics.requestedObjectsPerPage,
      last_marker: null,
    }
  } catch (error) {
    if (
      !(error instanceof LedgerObjectScanError) ||
      !error.message.includes(`page limit ${probePagesPerType} reached before completion`)
    ) {
      throw error
    }

    return {
      filter: options.filter,
      complete: false,
      pages: error.pagesCompleted,
      requests: error.pagesCompleted,
      objects: error.objectsRead,
      elapsed_ms: Date.now() - startedAt,
      average_objects_per_page:
        error.pagesCompleted === 0 ? 0 : error.objectsRead / error.pagesCompleted,
      requested_objects_per_page: requestedObjectsPerPage,
      last_marker: error.lastMarker,
    }
  }
}

describe.runIf(runLive)('live current-state benchmark', () => {
  it('records bounded binary traversal evidence for every current object type', async () => {
    const snapshot = await readNetworkSnapshot({
      endpoints: [endpoint],
      timeoutMs: 15_000,
    })
    const heapBefore = process.memoryUsage().heapUsed
    const probes: ProbeResult[] = []

    for (const filter of ['vault', 'loan_broker', 'loan'] as const) {
      probes.push(
        await probeType({
          filter,
          endpoint: snapshot.endpoint,
          ledgerHash: snapshot.validatedLedger.hash,
          ledgerIndex: snapshot.validatedLedger.index,
        }),
      )
    }

    const heapAfter = process.memoryUsage().heapUsed
    const artifact = {
      schema_version: 2,
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
        pages_per_type: probePagesPerType,
        requested_objects_per_page: requestedObjectsPerPage,
      },
      probes,
      process_heap_delta_bytes: heapAfter - heapBefore,
      all_types_observed: probes.every((probe) => probe.pages > 0),
      full_scan_attempted: false,
    }

    await writeArtifact(artifact)
    console.info(`CURRENT_STATE_BENCHMARK=${JSON.stringify(artifact)}`)
    expect(probes).toHaveLength(3)
    expect(probes.every((probe) => probe.pages > 0)).toBe(true)
    expect(probes.every((probe) => probe.objects >= 0)).toBe(true)
  }, 180_000)
})
