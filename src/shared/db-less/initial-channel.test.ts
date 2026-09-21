import { describe, expect, it } from 'vitest'

import {
  buildDbLessBaseManifest,
  type DbLessBaseAssetDescriptorV1,
} from './base-manifest'
import { buildDbLessInitialChannel } from './initial-channel'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'

const BASE_HASH = 'A'.repeat(64)
const ARCHIVE_START = 'B'.repeat(64)
const ARCHIVE_END = 'C'.repeat(64)
const SHA = 'a'.repeat(64)

async function baseFixture() {
  const lookupAssets: DbLessBaseAssetDescriptorV1[] = Array.from({ length: 16 }, (_, ordinal) => ({
    key: `lookup-${ordinal}.json.gz`,
    kind: 'lookup' as const,
    ordinal,
    records: 0,
    bytes: 1,
    sha256: SHA,
  }))
  const manifest = await buildDbLessBaseManifest({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-3371675',
    snapshotId: 'snapshot-test',
    generationId: 'base-test',
    sourceRevision: 'revision-test',
    sourceManifestSha256: SHA,
    ledgerIndex: 5_218_039,
    ledgerHash: BASE_HASH,
    complete: true,
    pageSize: 4096,
    lookupPrefixLength: 1,
    counts: { vaults: 0, loanBrokers: 0, loans: 0 },
    pageCounts: { vaults: 0, loanBrokers: 0, loans: 0 },
    assets: lookupAssets,
  })
  const bytes = utf8(`${canonicalJson(manifest)}\n`)
  return { manifest, bytes }
}

async function archiveFixture() {
  const publication = {
    schemaVersion: 1 as const,
    network: 'devnet' as const,
    complete: true as const,
    chainId: 'canonical-devnet-test',
    epochId: 'devnet-3371675',
    startLedgerIndex: 3_371_676,
    startLedgerHash: ARCHIVE_START,
    endLedgerIndex: 3_932_301,
    endLedgerHash: ARCHIVE_END,
    ledgerCount: 560_626,
  }
  const bytes = utf8(`${canonicalJson(publication)}\n`)
  const publicationSha256 = await sha256Hex(bytes)
  const exactIndexBytes = utf8('{"schemaVersion":2}\n')
  const exactIndexSha256 = await sha256Hex(exactIndexBytes)
  const channel = {
    schemaVersion: 1 as const,
    active: {
      dataCommitSha: '12252ce9df0d5ab50adc51e2743edb8ff03989dd',
      publicationPath: 'history/publication.json',
      publicationSha256,
      chainId: publication.chainId,
      epochId: publication.epochId,
      exactIndex: {
        manifestPath: 'history/index/exact/manifest.json',
        manifestSha256: exactIndexSha256,
      },
    },
    updatedAt: '2026-07-25T10:00:11.000Z',
  }
  return { publication, bytes, exactIndexBytes, channel }
}

describe('DB-less initial channel', () => {
  it('pins a Release base and immutable legacy History publication without claiming the gap', async () => {
    const base = await baseFixture()
    const archive = await archiveFixture()
    const channel = await buildDbLessInitialChannel({
      baseManifest: base.manifest,
      baseManifestBytes: base.bytes,
      baseLocation: {
        provider: 'github-release',
        repository: 'badjoke-lab/xrpl-lending-monitor',
        releaseTag: 'd2-current-base-test',
      },
      baseManifestKey: 'base-manifest.json',
      archiveChannel: archive.channel,
      archivePublication: archive.publication,
      archivePublicationBytes: archive.bytes,
      archiveExactIndexBytes: archive.exactIndexBytes,
      archiveRepository: 'badjoke-lab/xrpl-lending-monitor',
      updatedAt: '2026-09-20T02:00:00.000Z',
    })

    expect(channel.base.location).toEqual({
      provider: 'github-release',
      repository: 'badjoke-lab/xrpl-lending-monitor',
      releaseTag: 'd2-current-base-test',
    })
    expect(channel.live).toBeNull()
    expect(channel.lastCommittedLedgerIndex).toBe(base.manifest.ledgerIndex)
    expect(channel.historyCoverage).toHaveLength(1)
    expect(channel.historyCoverage[0]).toMatchObject({
      source: 'archive',
      startLedgerIndex: 3_371_676,
      endLedgerIndex: 3_932_301,
      location: {
        provider: 'github-commit',
        commitSha: '12252ce9df0d5ab50adc51e2743edb8ff03989dd',
      },
      manifestKey: 'history/publication.json',
      exactIndex: {
        manifestKey: 'history/index/exact/manifest.json',
      },
    })
    expect(channel.base.ledgerIndex - channel.historyCoverage[0]!.endLedgerIndex).toBeGreaterThan(1)
  })

  it('fails closed when legacy publication bytes do not match the pinned channel digest', async () => {
    const base = await baseFixture()
    const archive = await archiveFixture()

    await expect(buildDbLessInitialChannel({
      baseManifest: base.manifest,
      baseManifestBytes: base.bytes,
      baseLocation: {
        provider: 'github-release',
        repository: 'badjoke-lab/xrpl-lending-monitor',
        releaseTag: 'd2-current-base-test',
      },
      baseManifestKey: 'base-manifest.json',
      archiveChannel: archive.channel,
      archivePublication: archive.publication,
      archivePublicationBytes: utf8('{}\n'),
      archiveRepository: 'badjoke-lab/xrpl-lending-monitor',
      updatedAt: '2026-09-20T02:00:00.000Z',
    })).rejects.toThrow('pinned channel digest')
  })

  it('fails closed when the legacy channel and publication disagree on chain identity', async () => {
    const base = await baseFixture()
    const archive = await archiveFixture()

    await expect(buildDbLessInitialChannel({
      baseManifest: base.manifest,
      baseManifestBytes: base.bytes,
      baseLocation: {
        provider: 'github-release',
        repository: 'badjoke-lab/xrpl-lending-monitor',
        releaseTag: 'd2-current-base-test',
      },
      baseManifestKey: 'base-manifest.json',
      archiveChannel: {
        ...archive.channel,
        active: { ...archive.channel.active, chainId: 'wrong-chain' },
      },
      archivePublication: archive.publication,
      archivePublicationBytes: archive.bytes,
      archiveExactIndexBytes: archive.exactIndexBytes,
      archiveRepository: 'badjoke-lab/xrpl-lending-monitor',
      updatedAt: '2026-09-20T02:00:00.000Z',
    })).rejects.toThrow('chain ID')
  })
})