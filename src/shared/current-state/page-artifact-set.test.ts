import { describe, expect, it } from 'vitest'

import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { ArtifactMetadata, ArtifactStore } from './artifact-metadata'
import { InMemoryArtifactStore } from './in-memory-artifact-store'
import { buildPageArtifactSet } from './page-artifact-set'
import { persistPageArtifactSet } from './persist-page-artifact-set'

const identity = {
  network: 'devnet' as const,
  epochId: 'epoch-1',
  snapshotId: 'snapshot-1',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
}

function value(
  type: 'Vault' | 'LoanBroker' | 'Loan',
  index: string,
  fields: Record<string, unknown> = {},
): ScannedLedgerObject {
  return { LedgerEntryType: type, index, BinaryHex: 'ABCD', Flags: 0, ...fields }
}

async function buildFixture() {
  return buildPageArtifactSet({
    identity,
    pageSequence: 4,
    markerAfter: { cursor: 'next-page' },
    vaults: [value('Vault', 'V1', { Owner: 'rOwner' })],
    loanBrokers: [value('LoanBroker', 'B1', { VaultID: 'V1' })],
    loans: [value('Loan', 'L1', { Borrower: 'rBorrower', LoanBrokerID: 'B1' })],
  })
}

class RecordingStore implements ArtifactStore {
  readonly delegate = new InMemoryArtifactStore()
  readonly writes: string[] = []
  constructor(readonly failOnWrite: number | null = null) {}

  async write(key: string, bytes: Uint8Array, sha256: string): Promise<void> {
    this.writes.push(key)
    if (this.failOnWrite === this.writes.length) throw new Error('Injected write failure')
    await this.delegate.write(key, bytes, sha256)
  }

  read(key: string): Promise<Uint8Array | null> {
    return this.delegate.read(key)
  }

  inspect(key: string): Promise<ArtifactMetadata | null> {
    return this.delegate.inspect(key)
  }

  enumerate(prefix: string): Promise<ArtifactMetadata[]> {
    return this.delegate.enumerate(prefix)
  }
}

describe('page artifact commit boundary', () => {
  it('builds one deterministic manifest for data and index artifacts', async () => {
    const first = await buildFixture()
    const second = await buildFixture()

    expect(first.manifest.dataShards).toHaveLength(3)
    expect(first.manifest.indexShards.map((shard) => shard.indexKind)).toEqual([
      'account',
      'object-id',
      'relationship',
      'search',
    ])
    expect(first.manifest.markerAfter).toEqual({ cursor: 'next-page' })
    expect(first.manifestSha256).toBe(second.manifestSha256)
    expect(first.manifestKey).toContain('/pages/00000004/manifest.json')
  })

  it('commits the checkpoint only after every artifact and manifest are durable', async () => {
    const artifactSet = await buildFixture()
    const store = new RecordingStore()
    const checkpoints: unknown[] = []

    const checkpoint = await persistPageArtifactSet({
      store,
      artifactSet,
      commitCheckpoint: async (value) => { checkpoints.push(value) },
    })

    expect(store.writes.at(-1)).toBe(artifactSet.manifestKey)
    expect(checkpoints).toEqual([checkpoint])
    expect(checkpoint.markerAfter).toEqual({ cursor: 'next-page' })
    expect(await store.inspect(artifactSet.manifestKey)).toEqual({
      key: artifactSet.manifestKey,
      size: artifactSet.manifestBytes.byteLength,
      sha256: artifactSet.manifestSha256,
    })
  })

  it('does not advance the checkpoint after a partial write failure', async () => {
    const artifactSet = await buildFixture()
    const store = new RecordingStore(2)
    let commits = 0

    await expect(persistPageArtifactSet({
      store,
      artifactSet,
      commitCheckpoint: async () => { commits += 1 },
    })).rejects.toThrow('Injected write failure')
    expect(commits).toBe(0)
    expect(await store.inspect(artifactSet.manifestKey)).toBeNull()
  })
})
