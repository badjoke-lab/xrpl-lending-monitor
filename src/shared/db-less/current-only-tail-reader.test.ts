import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type { DbLessChannelV1 } from './channel'
import {
  readDbLessCurrentOnlyTailV1,
} from './current-only-tail-reader'

const HASH = 'A'.repeat(64)
const SOURCE = 'b'.repeat(64)
const DIGEST = `sha256:${'c'.repeat(64)}`
const LOCATION = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'db-less-live-data-v1-20261011-16',
}
const GENERATION = 'live-v1-101-102-aaaaaaaaaaaaaaaa-cccccccccccc'

async function fixture() {
  const document = {
    schemaVersion: 1 as const,
    network: 'devnet' as const,
    epochId: 'epoch-1',
    baseIdentity: 'base-1',
    generationId: GENERATION,
    sourceDeltaManifestSha256: SOURCE,
    payloadDigest: DIGEST,
    previousLedgerIndex: 100,
    expectedParentHash: HASH,
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    endLedgerHash: HASH,
    currentProjectionMutations: 1,
    records: [{
      semanticClass: 'current-projection' as const,
      canonicalKey: 'vault:V1',
      sourceLedgerIndex: 102,
      sourceLedgerHash: HASH,
      sourceTransactionHash: 'D'.repeat(64),
      objectId: 'V1',
      relationshipIds: [],
      isTombstone: true,
      value: null,
    }],
  }
  const bytes = utf8(`${canonicalJson(document)}\n`)
  const key = `${GENERATION}-current-only-v1.json`
  const channel = {
    network: 'devnet',
    epochId: 'epoch-1',
    base: { generationId: 'base-1' },
    lastCommittedLedgerIndex: 102,
    lastCommittedLedgerHash: HASH,
    currentProjectionTail: {
      schemaVersion: 1,
      coverageStartLedgerIndex: 100,
      coverageStartLedgerHash: HASH,
      generations: [{
        location: LOCATION,
        generationId: GENERATION,
        manifestKey: `${GENERATION}-manifest.json`,
        manifestSha256: SOURCE,
        payloadDigest: DIGEST,
        previousLedgerIndex: 100,
        expectedParentHash: HASH,
        startLedgerIndex: 101,
        startLedgerHash: HASH,
        endLedgerIndex: 102,
        endLedgerHash: HASH,
        ledgerCount: 2,
        currentProjectionMutations: 1,
        currentOnly: {
          key,
          sha256: await sha256Hex(bytes),
          bytes: bytes.byteLength,
          sourceDeltaManifestSha256: SOURCE,
        },
      }],
    },
  } as DbLessChannelV1
  const checkpoint = {
    epochId: 'epoch-1', baseIdentity: 'base-1',
    throughLedgerIndex: 100, throughLedgerHash: HASH,
  }
  return { channel, checkpoint, bytes, key }
}

describe('bounded Current-only tail reader for D5', () => {
  it('resolves only the content-addressed Current-only asset and preserves tombstones', async () => {
    const f = await fixture()
    const reads: string[] = []
    const result = await readDbLessCurrentOnlyTailV1({
      channel: f.channel,
      checkpoint: f.checkpoint,
      readArtifact: async (_location, key) => {
        reads.push(key)
        return key === f.key ? f.bytes : null
      },
    })
    expect(reads).toEqual([f.key])
    expect(result.assetReads).toBe(1)
    expect(result.transferredBytes).toBe(f.bytes.byteLength)
    expect(result.generations[0]?.records[0]?.isTombstone).toBe(true)
  })

  it('refuses to fall back to historical normalized chunks for legacy pointers', async () => {
    const f = await fixture()
    delete f.channel.currentProjectionTail?.generations[0]?.currentOnly
    let accessed = false
    await expect(readDbLessCurrentOnlyTailV1({
      channel: f.channel,
      checkpoint: f.checkpoint,
      readArtifact: async () => { accessed = true; return null },
    })).rejects.toThrow(/pointer is missing/)
    expect(accessed).toBe(false)
  })

  it('enforces total bytes before any network reads and rejects incorrect SHA', async () => {
    const f = await fixture()
    let accessed = false
    await expect(readDbLessCurrentOnlyTailV1({
      channel: f.channel,
      checkpoint: f.checkpoint,
      maxTotalBytes: f.bytes.byteLength - 1,
      readArtifact: async () => { accessed = true; return f.bytes },
    })).rejects.toThrow(/total byte budget/)
    expect(accessed).toBe(false)
    const changed = new Uint8Array(f.bytes)
    changed[5] = 0
    await expect(readDbLessCurrentOnlyTailV1({
      channel: f.channel,
      checkpoint: f.checkpoint,
      readArtifact: async () => changed,
    })).rejects.toThrow(/digest/)
  })

  it('rejects a checkpoint that cuts through the indexed Current generation', async () => {
    const f = await fixture()
    await expect(readDbLessCurrentOnlyTailV1({
      channel: f.channel,
      checkpoint: { ...f.checkpoint, throughLedgerIndex: 101 },
      readArtifact: async () => f.bytes,
    })).rejects.toThrow(/cuts through/)
  })
})
