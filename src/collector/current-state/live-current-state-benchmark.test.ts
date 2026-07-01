import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from './normalize-current-objects'
import { scanCurrentStateBatch } from './scan-current-state'

const runLive = process.env.RUN_LIVE_CURRENT_STATE_BENCHMARK === 'true'
const endpoint =
  process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const artifactPath = 'artifacts/current-state-live-benchmark.json'
const probePages = 25

async function writeArtifact(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

interface ProjectionFailure {
  type: 'vault' | 'loan_broker' | 'loan'
  index: string
  message: string
  fieldNames: string[]
  diagnostic: Record<string, unknown>
}

function diagnostic(value: Record<string, unknown>, type: ProjectionFailure['type']) {
  if (type === 'vault') {
    return {
      ShareMPTID: value.ShareMPTID ?? null,
      ShareMPTIDType: typeof value.ShareMPTID,
      ShareMPTIDJson: JSON.stringify(value.ShareMPTID ?? null),
      Asset: value.Asset ?? null,
    }
  }
  if (type === 'loan_broker') {
    return {
      VaultID: value.VaultID ?? null,
      OwnerCount: value.OwnerCount ?? null,
      DebtTotal: value.DebtTotal ?? null,
    }
  }
  return {
    LoanBrokerID: value.LoanBrokerID ?? null,
    Flags: value.Flags ?? null,
    PrincipalOutstanding: value.PrincipalOutstanding ?? null,
  }
}

describe.runIf(runLive)('live current-state benchmark', () => {
  it('validates live projection field shapes in a bounded single pass', async () => {
    const snapshot = await readNetworkSnapshot({
      endpoints: [endpoint],
      timeoutMs: 15_000,
    })
    const failures: ProjectionFailure[] = []
    const normalizedCounts = { vaults: 0, loan_brokers: 0, loans: 0 }
    const heapBefore = process.memoryUsage().heapUsed
    const startedAt = Date.now()

    const result = await scanCurrentStateBatch({
      endpoint: snapshot.endpoint,
      timeoutMs: 15_000,
      ledgerHash: snapshot.validatedLedger.hash,
      ledgerIndex: snapshot.validatedLedger.index,
      maxPages: probePages,
      objectLimitPerPage: 2_048,
      onPage(page) {
        const groups = [
          ['vault', page.vaults, normalizeVault],
          ['loan_broker', page.loanBrokers, normalizeLoanBroker],
          ['loan', page.loans, normalizeLoan],
        ] as const

        for (const [type, values, normalize] of groups) {
          for (const value of values) {
            try {
              normalize(value as never)
              normalizedCounts[type === 'loan_broker' ? 'loan_brokers' : `${type}s`] += 1
            } catch (error) {
              if (failures.length < 50) {
                failures.push({
                  type,
                  index: value.index,
                  message: error instanceof Error ? error.message : String(error),
                  fieldNames: Object.keys(value).sort(),
                  diagnostic: diagnostic(value, type),
                })
              }
            }
          }
        }
      },
    })

    const artifact = {
      schema_version: 4,
      observed_at: snapshot.observedAt,
      endpoint: snapshot.endpoint,
      ledger: snapshot.validatedLedger,
      probe_configuration: {
        response_mode: 'binary',
        traversal: 'single_pass_unfiltered_resumable',
        pages: probePages,
        requested_objects_per_page: 2_048,
      },
      result: {
        complete: result.complete,
        next_marker: result.nextMarker,
        metrics: result.metrics,
        normalized_counts: normalizedCounts,
        projection_failure_count: failures.length,
        projection_failures: failures,
      },
      elapsed_ms: Date.now() - startedAt,
      process_heap_delta_bytes: process.memoryUsage().heapUsed - heapBefore,
    }

    await writeArtifact(artifact)
    console.info(`CURRENT_STATE_BENCHMARK=${JSON.stringify(artifact)}`)
    expect(result.metrics.pages).toBe(probePages)
    expect(result.metrics.decodedObjects).toBeGreaterThan(0)
    expect(failures).toEqual([])
  }, 180_000)
})
