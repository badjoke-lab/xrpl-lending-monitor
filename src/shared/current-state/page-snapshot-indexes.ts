import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { buildSnapshotIndexArtifacts } from './snapshot-index-codec'
import { buildSnapshotIndexEntries } from './snapshot-index-entries'
import type { SnapshotIndexArtifact, SnapshotIndexKind } from './snapshot-index-types'
import type { SnapshotArtifact, SnapshotIdentity } from './snapshot-types'

const INDEX_KINDS: SnapshotIndexKind[] = ['object-id', 'account', 'relationship', 'search']

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export async function buildPageSnapshotIndexes(options: {
  identity: SnapshotIdentity
  pageSequence: number
  dataArtifacts: readonly SnapshotArtifact[]
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
  maxEntriesPerShard?: number
  maxUncompressedBytes?: number
}): Promise<SnapshotIndexArtifact[]> {
  if (!Number.isSafeInteger(options.pageSequence) || options.pageSequence < 1) {
    throw new Error('pageSequence must be a positive safe integer')
  }

  const entries = buildSnapshotIndexEntries(options)
  const artifactGroups = await Promise.all(INDEX_KINDS.map((indexKind) => (
    buildSnapshotIndexArtifacts({
      identity: options.identity,
      pageSequence: options.pageSequence,
      indexKind,
      entries: entries[indexKind],
      maxEntriesPerShard: options.maxEntriesPerShard,
      maxUncompressedBytes: options.maxUncompressedBytes,
    })
  )))

  return artifactGroups.flat().sort((left, right) => compareText(left.key, right.key))
}
