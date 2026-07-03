import { describe, expect, it } from 'vitest'

import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { buildPageSnapshotIndexes } from './page-snapshot-indexes'
import { buildPageSnapshotArtifacts } from './snapshot-artifacts'

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

const vaults = [value('Vault', 'V1', { Account: 'rVault', Owner: 'rOwner' })]
const loanBrokers = [value('LoanBroker', 'B1', {
  Account: 'rBroker',
  Owner: 'rOwner',
  VaultID: 'V1',
})]
const loans = [value('Loan', 'L1', { Borrower: 'rBorrower', LoanBrokerID: 'B1' })]

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function decodeGzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([asArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

async function buildFixture() {
  const data = await buildPageSnapshotArtifacts({
    identity,
    pageSequence: 7,
    vaults,
    loanBrokers,
    loans,
  })
  const indexes = await buildPageSnapshotIndexes({
    identity,
    pageSequence: 7,
    dataArtifacts: data.artifacts,
    vaults,
    loanBrokers,
    loans,
  })
  return { data, indexes }
}

describe('page snapshot indexes', () => {
  it('builds deterministic object, account, relationship, and search indexes', async () => {
    const first = await buildFixture()
    const second = await buildFixture()

    expect(first.indexes.map((artifact) => artifact.indexKind)).toEqual([
      'account',
      'object-id',
      'relationship',
      'search',
    ])
    expect(Object.fromEntries(first.indexes.map((artifact) => [
      artifact.indexKind,
      artifact.entryCount,
    ]))).toEqual({
      account: 5,
      'object-id': 3,
      relationship: 2,
      search: 7,
    })
    expect(first.indexes.map((artifact) => artifact.sha256)).toEqual(
      second.indexes.map((artifact) => artifact.sha256),
    )
  })

  it('maps object identifiers to immutable data shard keys', async () => {
    const fixture = await buildFixture()
    const artifact = fixture.indexes.find((candidate) => candidate.indexKind === 'object-id')
    if (!artifact) throw new Error('Missing object-id index')
    const entries = (await decodeGzip(artifact.bytes)).trim().split('\n').map((line) => JSON.parse(line))
    const vault = entries.find((entry) => entry.term === 'V1')
    expect(vault.value.dataKey).toBe(
      fixture.data.artifacts.find((candidate) => candidate.kind === 'vault')?.key,
    )
  })

  it('rejects duplicate object identifiers across kinds', async () => {
    const data = await buildPageSnapshotArtifacts({
      identity,
      pageSequence: 1,
      vaults: [value('Vault', 'SAME')],
      loanBrokers: [value('LoanBroker', 'SAME')],
      loans: [],
    })
    await expect(buildPageSnapshotIndexes({
      identity,
      pageSequence: 1,
      dataArtifacts: data.artifacts,
      vaults: [value('Vault', 'SAME')],
      loanBrokers: [value('LoanBroker', 'SAME')],
      loans: [],
    })).rejects.toThrow('Duplicate object identifier SAME')
  })
})
