import { describe, expect, it } from 'vitest'

import type { ArtifactStore } from './artifact-metadata'
import {
  ReleaseNativeReader,
  type ReleaseNativeManifest,
} from './release-native-reader'

const digest = 'a'.repeat(64)
const objectId = 'A'.repeat(64)

function manifest(): ReleaseNativeManifest {
  return {
    schemaVersion: 2,
    network: 'devnet',
    endpoint: 'https://example.invalid',
    epochId: 'epoch-1',
    snapshotId: 'snapshot-1',
    releaseTag: 'test-release',
    ledgerIndex: 100,
    ledgerHash: objectId,
    complete: true,
    sourcePages: 1,
    decodedObjectCount: 1,
    relevantObjectCount: 1,
    counts: { vaults: 0, loanBrokers: 1, loans: 0 },
    layout: {
      pagesPerSegment: 1,
      indexBuckets: 1,
      dataSegmentCount: 1,
      hashFunction: 'sha256-first-u32-mod-bucket-count',
    },
    dataAssets: [{
      assetName: 'segment-0001.ndjson.gz',
      segmentId: 'segment-0001',
      sha256: digest,
      compressedBytes: 1,
      uncompressedBytes: 1,
      recordCount: 1,
      sourcePages: { first: 1, last: 1, count: 1 },
      firstObjectId: objectId,
      lastObjectId: objectId,
      counts: { vaults: 0, loanBrokers: 1, loans: 0 },
    }],
    indexAssets: [{
      assetName: 'index-0000.ndjson.gz',
      bucket: 0,
      sha256: digest,
      compressedBytes: 1,
      uncompressedBytes: 1,
      recordCount: 0,
      firstTerm: null,
      lastTerm: null,
    }],
    totals: {
      dataCompressedBytes: 1,
      dataUncompressedBytes: 1,
      indexCompressedBytes: 1,
      indexUncompressedBytes: 1,
    },
    manifestSha256: digest,
  }
}

describe('release-native sparse-kind listing', () => {
  it('does not read a data asset whose manifest count for the requested kind is zero', async () => {
    let reads = 0
    const store: ArtifactStore = {
      async write() {},
      async read() {
        reads += 1
        throw new Error('zero-kind data asset must not be read')
      },
      async inspect() {
        return null
      },
      async enumerate() {
        return []
      },
    }

    const reader = ReleaseNativeReader.openFromManifest({ store, manifest: manifest() })
    const result = await reader.listObjects('vault', { limit: 1, maxAssetReads: 4 })

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      complete: true,
      assetReads: 0,
    })
    expect(reads).toBe(0)
  })
})
