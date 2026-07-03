import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { canonicalJson, sha256Hex, utf8 } from './canonical-json'
import { buildPageSnapshotIndexes } from './page-snapshot-indexes'
import type { PageArtifactSet } from './page-artifact-types'
import { buildPageSnapshotArtifacts } from './snapshot-artifacts'
import type { SnapshotIdentity } from './snapshot-types'

function prefix(identity: SnapshotIdentity): string {
  return `current-state/${identity.network}/${identity.epochId}/${identity.snapshotId}`
}

function pageToken(value: number): string {
  return String(value).padStart(8, '0')
}

export async function buildPageArtifactSet(options: {
  identity: SnapshotIdentity
  pageSequence: number
  markerAfter?: unknown
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
  maxObjectsPerShard?: number
  maxDataUncompressedBytes?: number
  maxIndexEntriesPerShard?: number
  maxIndexUncompressedBytes?: number
}): Promise<PageArtifactSet> {
  const data = await buildPageSnapshotArtifacts({
    identity: options.identity,
    pageSequence: options.pageSequence,
    vaults: options.vaults,
    loanBrokers: options.loanBrokers,
    loans: options.loans,
    maxObjectsPerShard: options.maxObjectsPerShard,
    maxUncompressedBytes: options.maxDataUncompressedBytes,
  })
  const indexArtifacts = await buildPageSnapshotIndexes({
    identity: options.identity,
    pageSequence: options.pageSequence,
    dataArtifacts: data.artifacts,
    vaults: options.vaults,
    loanBrokers: options.loanBrokers,
    loans: options.loans,
    maxEntriesPerShard: options.maxIndexEntriesPerShard,
    maxUncompressedBytes: options.maxIndexUncompressedBytes,
  })

  const dataShards = data.artifacts.map(({ bytes: _bytes, ...descriptor }) => descriptor)
  const indexShards = indexArtifacts.map(({ bytes: _bytes, ...descriptor }) => descriptor)
  const manifest = {
    schemaVersion: 1 as const,
    identity: options.identity,
    pageSequence: options.pageSequence,
    markerAfter: options.markerAfter ?? null,
    dataShards,
    indexShards,
    totals: {
      dataObjects: dataShards.reduce((total, shard) => total + shard.objectCount, 0),
      indexEntries: indexShards.reduce((total, shard) => total + shard.entryCount, 0),
      uncompressedBytes: [
        ...dataShards.map((shard) => shard.uncompressedBytes),
        ...indexShards.map((shard) => shard.uncompressedBytes),
      ].reduce((total, value) => total + value, 0),
      compressedBytes: [
        ...dataShards.map((shard) => shard.compressedBytes),
        ...indexShards.map((shard) => shard.compressedBytes),
      ].reduce((total, value) => total + value, 0),
    },
  }
  const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
  return {
    dataArtifacts: data.artifacts,
    indexArtifacts,
    manifest,
    manifestKey: `${prefix(options.identity)}/pages/${pageToken(options.pageSequence)}/manifest.json`,
    manifestBytes,
    manifestSha256: await sha256Hex(manifestBytes),
  }
}
