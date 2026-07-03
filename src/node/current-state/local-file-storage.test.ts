import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import type { ArtifactBootstrapCheckpoint } from '../../shared/current-state/artifact-bootstrap-types'
import { sha256Hex, utf8 } from '../../shared/current-state/canonical-json'
import {
  LocalFileArtifactBootstrapCheckpointStore,
  LocalFileArtifactStore,
} from './local-file-storage'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'xrpl-lending-artifacts-'))
  roots.push(root)
  return root
}

function checkpoint(): ArtifactBootstrapCheckpoint {
  return {
    schemaVersion: 1,
    network: 'devnet',
    endpoint: 'https://example.invalid',
    epochId: 'epoch-1',
    snapshotId: 'snapshot-1',
    ledgerIndex: 100,
    ledgerHash: 'A'.repeat(64),
    nextMarker: { cursor: 'next' },
    nextPageSequence: 2,
    scanComplete: false,
    metrics: {
      pages: 1,
      requests: 1,
      decodedObjects: 1,
      objects: 1,
      elapsedMs: 10,
      requestedObjectsPerPage: 2_048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 1 },
        loan_broker: { objects: 0 },
        loan: { objects: 0 },
      },
    },
    pageManifests: [
      {
        pageSequence: 1,
        key: 'current-state/devnet/epoch-1/snapshot-1/pages/00000001/manifest.json',
        sha256: 'B'.repeat(64),
      },
    ],
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local file artifact storage', () => {
  it('writes, reads, inspects, and enumerates immutable artifacts', async () => {
    const root = await temporaryRoot()
    const store = new LocalFileArtifactStore(join(root, 'artifacts'))
    const key = 'current-state/devnet/epoch-1/snapshot-1/data/vault/00000001-0001.ndjson.gz'
    const bytes = utf8('artifact')
    const digest = await sha256Hex(bytes)

    await store.write(key, bytes, digest)
    await store.write(key, bytes, digest)

    expect(await store.read(key)).toEqual(bytes)
    expect(await store.inspect(key)).toEqual({ key, size: bytes.byteLength, sha256: digest })
    expect(await store.enumerate('current-state/devnet/epoch-1/snapshot-1/')).toEqual([
      { key, size: bytes.byteLength, sha256: digest },
    ])
  })

  it('rejects immutable changes and unsafe keys', async () => {
    const root = await temporaryRoot()
    const store = new LocalFileArtifactStore(join(root, 'artifacts'))
    const key = 'current-state/devnet/epoch-1/snapshot-1/manifest.json'
    const first = utf8('first')
    await store.write(key, first, await sha256Hex(first))

    const second = utf8('second')
    await expect(store.write(key, second, await sha256Hex(second))).rejects.toThrow(
      'Immutable artifact mismatch',
    )
    await expect(store.write('../escape', first, await sha256Hex(first))).rejects.toThrow(
      'invalid path segment',
    )
  })

  it('persists and reloads checkpoint JSON across store instances', async () => {
    const root = await temporaryRoot()
    const checkpointRoot = join(root, 'checkpoints')
    const first = new LocalFileArtifactBootstrapCheckpointStore(checkpointRoot)
    await first.save(checkpoint())

    const second = new LocalFileArtifactBootstrapCheckpointStore(checkpointRoot)
    expect(await second.load('snapshot-1')).toEqual(checkpoint())
  })

  it('rejects invalid checkpoint files', async () => {
    const root = await temporaryRoot()
    const checkpointRoot = join(root, 'checkpoints')
    const store = new LocalFileArtifactBootstrapCheckpointStore(checkpointRoot)
    await store.save(checkpoint())
    const path = join(checkpointRoot, 'snapshot-1.json')
    await writeFile(path, '{}')

    await expect(store.load('snapshot-1')).rejects.toThrow('checkpoint schema is invalid')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({})
  })
})
