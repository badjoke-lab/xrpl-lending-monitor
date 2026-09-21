import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import {
  buildDbLessChannel,
  type DbLessChannelV1,
} from './channel'
import {
  finalizeDbLessLivePublication,
  prepareDbLessLiveDelta,
  prepareDbLessLivePublication,
} from './live-publication'

const LOCATION = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'test-release',
}
const SECOND_LOCATION = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'test-release-2',
}

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const SHA = 'a'.repeat(64)

async function initialChannel(): Promise<DbLessChannelV1> {
  return buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: LOCATION,
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-test-manifest.json',
      manifestSha256: SHA,
      ledgerIndex: 100,
      ledgerHash: A,
    },
    live: null,
    lastCommittedLedgerIndex: 100,
    lastCommittedLedgerHash: A,
    historyCoverage: [],
    updatedAt: '2026-09-20T00:00:00.000Z',
  })
}

function scan(options: {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  latestValidatedLedger?: number
}): IncrementalScanResult {
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: options.ledgerIndex,
    endLedgerIndex: options.ledgerIndex,
    latestValidatedLedger: options.latestValidatedLedger ?? options.ledgerIndex,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://example.invalid',
        ledgerIndex: options.ledgerIndex,
        ledgerHash: options.ledgerHash,
        parentHash: options.parentHash,
        closeTime: 800_000_000 + options.ledgerIndex,
        transactions: [],
        lendingTransactions: [],
      },
    ],
    metrics: {
      ledgers: 1,
      inspectedTransactions: 0,
      lendingTransactions: 0,
      elapsedMs: 1,
    },
  }
}

function caughtUpScan(): IncrementalScanResult {
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: 101,
    endLedgerIndex: null,
    latestValidatedLedger: 100,
    completeToLatest: true,
    ledgers: [],
    metrics: {
      ledgers: 0,
      inspectedTransactions: 0,
      lendingTransactions: 0,
      elapsedMs: 1,
    },
  }
}

describe('DB-less live publication preparation', () => {
  it('returns the existing verified channel when already caught up', async () => {
    const channel = await initialChannel()
    const result = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: caughtUpScan(),
      sourceRevision: 'revision-a',
    })

    expect(result).toEqual({ status: 'caught-up', channel })
  })

  it('prepares first delta, chain, and next channel without a persistence provider', async () => {
    const channel = await initialChannel()
    const result = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })

    expect(result.status).toBe('prepared')
    if (result.status !== 'prepared') return

    expect(result.immutableArtifacts.length).toBeGreaterThanOrEqual(3)
    expect(result.chain.manifest.generationCount).toBe(1)
    expect(result.chain.manifest.previous).toBeNull()
    expect(result.chain.manifest.delta.location).toEqual(LOCATION)
    expect(result.nextChannel.lastCommittedLedgerIndex).toBe(101)
    expect(result.nextChannel.lastCommittedLedgerHash).toBe(B)
    expect(result.nextChannel.live?.manifestKey).toBe(result.chain.manifestArtifact.key)
    expect(result.nextChannel.historyCoverage).toEqual([
      expect.objectContaining({
        rangeId: 'live:base-test',
        source: 'live',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
      }),
    ])
  })

  it('extends one live chain and one live history range across consecutive runs', async () => {
    const channel = await initialChannel()
    const first = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })
    if (first.status !== 'prepared') throw new Error('expected first publication')

    const second = await prepareDbLessLivePublication({
      channel: first.nextChannel,
      publicationLocation: SECOND_LOCATION,
      previousChain: first.chain.manifest,
      scan: scan({ ledgerIndex: 102, ledgerHash: C, parentHash: B }),
      sourceRevision: 'revision-a',
    })
    if (second.status !== 'prepared') throw new Error('expected second publication')

    expect(second.chain.manifest.generationCount).toBe(2)
    expect(second.chain.manifest.previous?.location).toEqual(LOCATION)
    expect(second.chain.manifest.previous?.generationId).toBe(first.chain.manifest.generationId)
    expect(second.chain.manifest.delta.location).toEqual(SECOND_LOCATION)
    expect(second.chain.manifest.startLedgerIndex).toBe(101)
    expect(second.chain.manifest.startLedgerHash).toBe(B)
    expect(second.chain.manifest.endLedgerIndex).toBe(102)
    expect(second.nextChannel.lastCommittedLedgerIndex).toBe(102)
    expect(second.nextChannel.lastCommittedLedgerHash).toBe(C)
    expect(second.nextChannel.live?.location).toEqual(SECOND_LOCATION)
    expect(second.nextChannel.live?.startLedgerHash).toBe(B)
    expect(second.nextChannel.historyCoverage).toHaveLength(1)
    expect(second.nextChannel.historyCoverage[0]).toMatchObject({
      rangeId: 'live:base-test',
      startLedgerIndex: 101,
      startLedgerHash: B,
      endLedgerIndex: 102,
      endLedgerHash: C,
    })
  })

  it('rejects an active live channel when its previous chain is missing', async () => {
    const channel = await initialChannel()
    const first = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })
    if (first.status !== 'prepared') throw new Error('expected first publication')

    await expect(prepareDbLessLivePublication({
      channel: first.nextChannel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 102, ledgerHash: C, parentHash: B }),
      sourceRevision: 'revision-a',
    })).rejects.toThrow('requires its previous live chain')
  })

  it('rejects a scan whose first parent hash diverges from the committed channel', async () => {
    const channel = await initialChannel()

    await expect(prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: C }),
      sourceRevision: 'revision-a',
    })).rejects.toThrow('first parent hash')
  })
  it('can choose the immutable Release only after delta artifact count is known', async () => {
    const channel = await initialChannel()
    const prepared = await prepareDbLessLiveDelta({
      channel,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })
    if (prepared.status !== 'delta-prepared') throw new Error('expected delta preparation')

    expect(prepared.immutableArtifactCountBeforeChain).toBe(
      prepared.delta.chunkArtifacts.length + 1,
    )

    const alternateLocation = {
      provider: 'github-release' as const,
      repository: 'badjoke-lab/xrpl-lending-monitor',
      releaseTag: 'test-release-r1',
    }
    const finalized = await finalizeDbLessLivePublication({
      prepared,
      publicationLocation: alternateLocation,
    })

    expect(finalized.immutableArtifacts).toHaveLength(
      prepared.immutableArtifactCountBeforeChain + 1,
    )
    expect(finalized.chain.manifest.publicationLocation).toEqual(alternateLocation)
    expect(finalized.nextChannel.live?.location).toEqual(alternateLocation)
  })

})