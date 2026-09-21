import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import { buildDbLessChannel } from './channel'
import {
  buildDbLessLiveChainArtifacts,
  verifyDbLessLiveChainManifest,
} from './live-chain'
import type {
  DbLessArtifact,
  DbLessLiveDeltaManifestV1,
} from './live-delta'

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

const BASE = 'A'.repeat(64)
const L101 = 'B'.repeat(64)
const L102 = 'C'.repeat(64)
const L103 = 'D'.repeat(64)
const L104 = 'E'.repeat(64)
const SHA = 'a'.repeat(64)

async function delta(options: {
  generationId: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  startLedgerHash: string
  endLedgerIndex: number
  endLedgerHash: string
}): Promise<{
  manifest: DbLessLiveDeltaManifestV1
  manifestArtifact: DbLessArtifact
}> {
  const ledgerCount = options.endLedgerIndex - options.startLedgerIndex + 1
  const payloadDigest = `sha256:${await sha256Hex(options.generationId)}`
  const manifest: DbLessLiveDeltaManifestV1 = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    generationId: options.generationId,
    workId: `work-${options.generationId}`,
    sourceRevision: 'revision-test',
    generatedAt: '2026-09-20T00:00:00.000Z',
    previousLedgerIndex: options.previousLedgerIndex,
    expectedParentHash: options.expectedParentHash,
    startLedgerIndex: options.startLedgerIndex,
    startLedgerHash: options.startLedgerHash,
    endLedgerIndex: options.endLedgerIndex,
    endLedgerHash: options.endLedgerHash,
    ledgerCount,
    payloadDigest,
    semanticCounts: {
      validatedLedgers: ledgerCount,
      protocolEvents: 0,
      objectChanges: 0,
      loanLifecycleEvents: 0,
      archivedObjects: 0,
      balanceHistory: 0,
      currentProjectionMutations: 0,
      totalRecords: ledgerCount,
    },
    chunks: [
      {
        chunkIndex: 0,
        key: `${options.generationId}-chunk-0000.json`,
        records: ledgerCount,
        bytes: 2,
        artifactSha256: SHA,
        chunkDigest: `sha256:${'b'.repeat(64)}`,
      },
    ],
  }
  const bytes = utf8(`${canonicalJson(manifest)}\n`)
  const manifestArtifact: DbLessArtifact = {
    key: `${options.generationId}-manifest.json`,
    mediaType: 'application/json',
    bytes,
    sha256: await sha256Hex(bytes),
    immutable: true,
  }
  return { manifest, manifestArtifact }
}

describe('DB-less live chain', () => {
  it('builds a first immutable chain from base + 1', async () => {
    const first = await delta({
      generationId: 'delta-1',
      previousLedgerIndex: 100,
      expectedParentHash: BASE,
      startLedgerIndex: 101,
      startLedgerHash: L101,
      endLedgerIndex: 102,
      endLedgerHash: L102,
      generationCount: 1,
      ledgerCount: 2,
    })

    const built = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION,
      deltaManifest: first.manifest,
      deltaManifestArtifact: first.manifestArtifact,
    })

    await expect(verifyDbLessLiveChainManifest(built.manifest)).resolves.toBeUndefined()
    expect(built.manifest.previous).toBeNull()
    expect(built.manifest.generationCount).toBe(1)
    expect(built.manifest.delta.generationId).toBe('delta-1')
    expect(built.manifest.delta.location).toEqual(LOCATION)
    expect(built.manifest.startLedgerIndex).toBe(101)
    expect(built.manifest.startLedgerHash).toBe(L101)
    expect(built.manifest.endLedgerIndex).toBe(102)
    expect(built.manifest.ledgerCount).toBe(2)
    expect(built.channelPointer.startParentHash).toBe(BASE)
  })

  it('appends a second delta while preserving a base-to-head channel pointer', async () => {
    const first = await delta({
      generationId: 'delta-1',
      previousLedgerIndex: 100,
      expectedParentHash: BASE,
      startLedgerIndex: 101,
      startLedgerHash: L101,
      endLedgerIndex: 102,
      endLedgerHash: L102,
    })
    const firstChain = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION,
      deltaManifest: first.manifest,
      deltaManifestArtifact: first.manifestArtifact,
    })
    const second = await delta({
      generationId: 'delta-2',
      previousLedgerIndex: 102,
      expectedParentHash: L102,
      startLedgerIndex: 103,
      startLedgerHash: L103,
      endLedgerIndex: 104,
      endLedgerHash: L104,
    })

    const secondChain = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: SECOND_LOCATION,
      previousChain: firstChain.manifest,
      deltaManifest: second.manifest,
      deltaManifestArtifact: second.manifestArtifact,
    })

    expect(secondChain.manifest.generationCount).toBe(2)
    expect(secondChain.manifest.previous).toMatchObject({
      location: LOCATION,
      generationId: firstChain.manifest.generationId,
      manifestKey: firstChain.manifestArtifact.key,
      manifestSha256: firstChain.manifestArtifact.sha256,
      payloadDigest: firstChain.manifest.chainDigest,
      startLedgerIndex: 101,
      startLedgerHash: L101,
      startParentHash: BASE,
      endLedgerIndex: 102,
      endLedgerHash: L102,
    })
    expect(secondChain.manifest.delta.generationId).toBe('delta-2')
    expect(secondChain.manifest.delta.location).toEqual(SECOND_LOCATION)
    expect(secondChain.manifest.startLedgerIndex).toBe(101)
    expect(secondChain.manifest.startLedgerHash).toBe(L101)
    expect(secondChain.manifest.endLedgerIndex).toBe(104)
    expect(secondChain.manifest.ledgerCount).toBe(4)
    expect(secondChain.channelPointer.location).toEqual(SECOND_LOCATION)
    expect(secondChain.channelPointer.startLedgerHash).toBe(L101)

    const channel = await buildDbLessChannel({
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
        ledgerHash: BASE,
      },
      live: secondChain.channelPointer,
      lastCommittedLedgerIndex: 104,
      lastCommittedLedgerHash: L104,
      historyCoverage: [],
      updatedAt: '2026-09-20T00:00:00.000Z',
    })

    expect(channel.live?.manifestKey).toBe(secondChain.manifestArtifact.key)
    expect(channel.live?.startLedgerIndex).toBe(101)
    expect(channel.live?.endLedgerIndex).toBe(104)
  })

  it('rejects tampered linked-chain cumulative counters', async () => {
    const first = await delta({
      generationId: 'delta-1',
      previousLedgerIndex: 100,
      expectedParentHash: BASE,
      startLedgerIndex: 101,
      startLedgerHash: L101,
      endLedgerIndex: 102,
      endLedgerHash: L102,
    })
    const firstChain = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION,
      deltaManifest: first.manifest,
      deltaManifestArtifact: first.manifestArtifact,
    })
    const second = await delta({
      generationId: 'delta-2',
      previousLedgerIndex: 102,
      expectedParentHash: L102,
      startLedgerIndex: 103,
      startLedgerHash: L103,
      endLedgerIndex: 104,
      endLedgerHash: L104,
    })
    const secondChain = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: SECOND_LOCATION,
      previousChain: firstChain.manifest,
      deltaManifest: second.manifest,
      deltaManifestArtifact: second.manifestArtifact,
    })
    if (!secondChain.manifest.previous) throw new Error('expected linked previous pointer')

    const tampered = {
      ...secondChain.manifest,
      previous: {
        ...secondChain.manifest.previous,
        ledgerCount: secondChain.manifest.previous.ledgerCount + 1,
      },
    }

    await expect(verifyDbLessLiveChainManifest(tampered)).rejects.toThrow(
      'cumulative ledger count',
    )
  })

  it('rejects a ledger gap when appending a delta', async () => {
    const first = await delta({
      generationId: 'delta-1',
      previousLedgerIndex: 100,
      expectedParentHash: BASE,
      startLedgerIndex: 101,
      startLedgerHash: L101,
      endLedgerIndex: 102,
      endLedgerHash: L102,
    })
    const firstChain = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION,
      deltaManifest: first.manifest,
      deltaManifestArtifact: first.manifestArtifact,
    })
    const gapped = await delta({
      generationId: 'delta-gap',
      previousLedgerIndex: 103,
      expectedParentHash: L102,
      startLedgerIndex: 104,
      startLedgerHash: L104,
      endLedgerIndex: 104,
      endLedgerHash: L104,
    })

    await expect(buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION,
      previousChain: firstChain.manifest,
      deltaManifest: gapped.manifest,
      deltaManifestArtifact: gapped.manifestArtifact,
    })).rejects.toThrow('previous ledger does not match prior head')
  })

  it('rejects a parent-hash discontinuity when appending a delta', async () => {
    const first = await delta({
      generationId: 'delta-1',
      previousLedgerIndex: 100,
      expectedParentHash: BASE,
      startLedgerIndex: 101,
      startLedgerHash: L101,
      endLedgerIndex: 102,
      endLedgerHash: L102,
    })
    const firstChain = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION,
      deltaManifest: first.manifest,
      deltaManifestArtifact: first.manifestArtifact,
    })
    const wrongParent = await delta({
      generationId: 'delta-parent',
      previousLedgerIndex: 102,
      expectedParentHash: L103,
      startLedgerIndex: 103,
      startLedgerHash: L103,
      endLedgerIndex: 104,
      endLedgerHash: L104,
    })

    await expect(buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION,
      previousChain: firstChain.manifest,
      deltaManifest: wrongParent.manifest,
      deltaManifestArtifact: wrongParent.manifestArtifact,
    })).rejects.toThrow('parent hash does not match prior head')
  })
})