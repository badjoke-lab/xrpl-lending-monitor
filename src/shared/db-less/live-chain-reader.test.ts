import { describe, expect, it } from 'vitest'

import { buildDbLessChannel } from './channel'
import {
  buildDbLessLiveChainArtifacts,
  type DbLessLiveChainArtifactSet,
} from './live-chain'
import {
  verifyDbLessLiveChainFromChannel,
  verifyDbLessLiveChainHeadFromChannel,
} from './live-chain-reader'
import type { DbLessLiveDeltaManifestV1, DbLessArtifact } from './live-delta'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'

const LOCATION_A = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'data-a',
}
const LOCATION_B = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'data-b',
}
const BASE = 'A'.repeat(64)
const L101 = 'B'.repeat(64)
const L102 = 'C'.repeat(64)
const L103 = 'D'.repeat(64)
const L104 = 'E'.repeat(64)
const L105 = 'F'.repeat(64)
const L106 = '1'.repeat(64)
const SHA = 'a'.repeat(64)

async function delta(options: {
  generationId: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  startLedgerHash: string
  endLedgerIndex: number
  endLedgerHash: string
}): Promise<{ manifest: DbLessLiveDeltaManifestV1; manifestArtifact: DbLessArtifact }> {
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
    chunks: [{
      chunkIndex: 0,
      key: `${options.generationId}-chunk-0000.json`,
      records: ledgerCount,
      bytes: 2,
      artifactSha256: SHA,
      chunkDigest: `sha256:${'b'.repeat(64)}`,
    }],
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

async function fixture(): Promise<{
  first: DbLessLiveChainArtifactSet
  second: DbLessLiveChainArtifactSet
  channel: Awaited<ReturnType<typeof buildDbLessChannel>>
  artifacts: Map<string, Uint8Array>
}> {
  const d1 = await delta({
    generationId: 'delta-1',
    previousLedgerIndex: 100,
    expectedParentHash: BASE,
    startLedgerIndex: 101,
    startLedgerHash: L101,
    endLedgerIndex: 102,
    endLedgerHash: L102,
  })
  const first = await buildDbLessLiveChainArtifacts({
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    baseLedgerIndex: 100,
    baseLedgerHash: BASE,
    publicationLocation: LOCATION_A,
    deltaManifest: d1.manifest,
    deltaManifestArtifact: d1.manifestArtifact,
  })

  const d2 = await delta({
    generationId: 'delta-2',
    previousLedgerIndex: 102,
    expectedParentHash: L102,
    startLedgerIndex: 103,
    startLedgerHash: L103,
    endLedgerIndex: 104,
    endLedgerHash: L104,
  })
  const second = await buildDbLessLiveChainArtifacts({
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    baseLedgerIndex: 100,
    baseLedgerHash: BASE,
    publicationLocation: LOCATION_B,
    previousChain: first.manifest,
    deltaManifest: d2.manifest,
    deltaManifestArtifact: d2.manifestArtifact,
  })

  const channel = await buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: LOCATION_A,
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-manifest.json',
      manifestSha256: SHA,
      ledgerIndex: 100,
      ledgerHash: BASE,
    },
    live: second.channelPointer,
    lastCommittedLedgerIndex: 104,
    lastCommittedLedgerHash: L104,
    historyCoverage: [],
    updatedAt: '2026-09-20T00:05:00.000Z',
  })

  const artifacts = new Map<string, Uint8Array>([
    [`${LOCATION_A.releaseTag}:${first.manifestArtifact.key}`, first.manifestArtifact.bytes],
    [`${LOCATION_B.releaseTag}:${second.manifestArtifact.key}`, second.manifestArtifact.bytes],
  ])

  return { first, second, channel, artifacts }
}

describe('DB-less linked live-chain reader', () => {
  it('verifies a two-generation chain across two Release locations', async () => {
    const built = await fixture()
    const summary = await verifyDbLessLiveChainFromChannel({
      channel: built.channel,
      readArtifact: async (pointer) => {
        if (pointer.location.provider !== 'github-release') return null
        return built.artifacts.get(`${pointer.location.releaseTag}:${pointer.manifestKey}`) ?? null
      },
      maxGenerations: 8,
    })

    expect(summary).toEqual({
      generationCount: 2,
      traversedManifests: 2,
      ledgerCount: 4,
      startLedgerIndex: 101,
      startLedgerHash: L101,
      startParentHash: BASE,
      endLedgerIndex: 104,
      endLedgerHash: L104,
      headGenerationId: built.second.manifest.generationId,
    })
  })

  it('verifies only the live head and immediate predecessor for a three-generation chain', async () => {
    const built = await fixture()
    const d3 = await delta({
      generationId: 'delta-3',
      previousLedgerIndex: 104,
      expectedParentHash: L104,
      startLedgerIndex: 105,
      startLedgerHash: L105,
      endLedgerIndex: 106,
      endLedgerHash: L106,
    })
    const third = await buildDbLessLiveChainArtifacts({
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      baseLedgerIndex: 100,
      baseLedgerHash: BASE,
      publicationLocation: LOCATION_A,
      previousChain: built.second.manifest,
      deltaManifest: d3.manifest,
      deltaManifestArtifact: d3.manifestArtifact,
    })
    const channel = await buildDbLessChannel({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'devnet-test',
      base: built.channel.base,
      live: third.channelPointer,
      lastCommittedLedgerIndex: 106,
      lastCommittedLedgerHash: L106,
      historyCoverage: [],
      updatedAt: '2026-09-20T00:10:00.000Z',
    })
    built.artifacts.set(
      `${LOCATION_A.releaseTag}:${third.manifestArtifact.key}`,
      third.manifestArtifact.bytes,
    )

    const reads: string[] = []
    const summary = await verifyDbLessLiveChainHeadFromChannel({
      channel,
      readArtifact: async (pointer) => {
        if (pointer.location.provider !== 'github-release') return null
        reads.push(pointer.generationId)
        return built.artifacts.get(`${pointer.location.releaseTag}:${pointer.manifestKey}`) ?? null
      },
    })

    expect(summary).toMatchObject({
      generationCount: 3,
      traversedManifests: 2,
      headGenerationId: third.manifest.generationId,
      previousGenerationId: built.second.manifest.generationId,
      endLedgerIndex: 106,
      endLedgerHash: L106,
    })
    expect(reads).toEqual([
      third.manifest.generationId,
      built.second.manifest.generationId,
    ])
    expect(reads).not.toContain(built.first.manifest.generationId)
  })

  it('rejects a live chain whose base identity differs from the active channel', async () => {
    const built = await fixture()
    const mismatched = await buildDbLessChannel({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'devnet-test',
      base: {
        ...built.channel.base,
        generationId: 'different-base',
      },
      live: built.channel.live,
      lastCommittedLedgerIndex: built.channel.lastCommittedLedgerIndex,
      lastCommittedLedgerHash: built.channel.lastCommittedLedgerHash,
      historyCoverage: built.channel.historyCoverage,
      updatedAt: built.channel.updatedAt,
    })

    await expect(verifyDbLessLiveChainFromChannel({
      channel: mismatched,
      readArtifact: async (pointer) => {
        if (pointer.location.provider !== 'github-release') return null
        return built.artifacts.get(`${pointer.location.releaseTag}:${pointer.manifestKey}`) ?? null
      },
      maxGenerations: 8,
    })).rejects.toThrow('active channel base context')
  })

  it('fails closed when a previous immutable chain artifact is missing', async () => {
    const built = await fixture()
    built.artifacts.delete(`${LOCATION_A.releaseTag}:${built.first.manifestArtifact.key}`)

    await expect(verifyDbLessLiveChainFromChannel({
      channel: built.channel,
      readArtifact: async (pointer) => {
        if (pointer.location.provider !== 'github-release') return null
        return built.artifacts.get(`${pointer.location.releaseTag}:${pointer.manifestKey}`) ?? null
      },
      maxGenerations: 8,
    })).rejects.toThrow('Missing live chain artifact')
  })

  it('rejects a chain that exceeds the bounded verification generation limit', async () => {
    const built = await fixture()

    await expect(verifyDbLessLiveChainFromChannel({
      channel: built.channel,
      readArtifact: async (pointer) => {
        if (pointer.location.provider !== 'github-release') return null
        return built.artifacts.get(`${pointer.location.releaseTag}:${pointer.manifestKey}`) ?? null
      },
      maxGenerations: 1,
    })).rejects.toThrow('bounded verification generation limit')
  })

  it('rejects immutable bytes that do not match the backlink SHA-256', async () => {
    const built = await fixture()
    built.artifacts.set(
      `${LOCATION_A.releaseTag}:${built.first.manifestArtifact.key}`,
      utf8('{}\n'),
    )

    await expect(verifyDbLessLiveChainFromChannel({
      channel: built.channel,
      readArtifact: async (pointer) => {
        if (pointer.location.provider !== 'github-release') return null
        return built.artifacts.get(`${pointer.location.releaseTag}:${pointer.manifestKey}`) ?? null
      },
      maxGenerations: 8,
    })).rejects.toThrow('SHA-256')
  })
})