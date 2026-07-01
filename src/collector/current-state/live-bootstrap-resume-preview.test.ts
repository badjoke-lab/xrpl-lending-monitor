import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import {
  runCurrentStateBootstrap,
  type BootstrapCheckpoint,
  type BootstrapCheckpointStore,
  type BootstrapIdentity,
  type BootstrapLifecycle,
  type BootstrapObjectStore,
} from './bootstrap-runner'
import { encodeCurrentStatePageGzip } from './bootstrap-shard-encoder'

const runLive = process.env.RUN_LIVE_BOOTSTRAP_RESUME_PREVIEW === 'true'
const endpoint = process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const artifactPath = 'artifacts/bootstrap-resume-preview.json'

function checkpointMemory(): {
  store: BootstrapCheckpointStore
  read: () => BootstrapCheckpoint | null
} {
  let checkpoint: BootstrapCheckpoint | null = null
  return {
    store: {
      async load() {
        return checkpoint
      },
      async save(value) {
        checkpoint = structuredClone(value)
      },
      async clear() {
        checkpoint = null
      },
    },
    read: () => checkpoint,
  }
}

function objectMemory(): { store: BootstrapObjectStore; shardKeys: string[] } {
  const objects = new Map<string, { bytes: Uint8Array; sha256: string }>()
  const shardKeys: string[] = []
  return {
    shardKeys,
    store: {
      async putShard(value) {
        const previous = objects.get(value.key)
        if (previous && previous.sha256 !== value.sha256) {
          throw new Error(`Preview shard key changed content: ${value.key}`)
        }
        if (!previous) shardKeys.push(value.key)
        objects.set(value.key, { bytes: value.bytes, sha256: value.sha256 })
        return { storedBytes: value.bytes.byteLength }
      },
      async putManifest(value) {
        objects.set(value.key, { bytes: value.bytes, sha256: value.sha256 })
      },
      async verifyManifest(value) {
        return objects.get(value.key)?.sha256 === value.sha256
      },
    },
  }
}

async function writeArtifact(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function markerText(marker: unknown): string {
  return JSON.stringify(marker)
}

describe.runIf(runLive)('live bootstrap resume preview', () => {
  it('interrupts after one page and resumes from the next Devnet marker', async () => {
    const network = await readNetworkSnapshot({ endpoints: [endpoint], timeoutMs: 15_000 })
    const identity: BootstrapIdentity = {
      snapshotId: `preview-${network.validatedLedger.index}`,
      epochId: `preview-${network.validatedLedger.hash.slice(0, 12)}`,
      endpoint: network.endpoint,
      ledgerIndex: network.validatedLedger.index,
      ledgerHash: network.validatedLedger.hash,
      objectPrefix: `preview/${network.validatedLedger.index}/${network.validatedLedger.hash}`,
    }
    const checkpoints = checkpointMemory()
    const objects = objectMemory()
    let beginCount = 0
    let activationCount = 0
    const lifecycle: BootstrapLifecycle = {
      async begin() {
        beginCount += 1
      },
      async activate() {
        activationCount += 1
      },
    }

    const runBatch = () =>
      runCurrentStateBootstrap({
        identity,
        checkpointStore: checkpoints.store,
        objectStore: objects.store,
        lifecycle,
        encodePage: encodeCurrentStatePageGzip,
        timeoutMs: 15_000,
        maxPagesPerBatch: 1,
        objectLimitPerPage: 2_048,
      })

    const first = await runBatch()
    expect(first.status).toBe('paused')
    expect(first.checkpoint?.nextPageNumber).toBe(2)
    expect(first.checkpoint?.shards).toHaveLength(1)
    expect(first.checkpoint?.nextMarker).not.toBeNull()
    const firstMarker = markerText(first.checkpoint?.nextMarker)

    const second = await runBatch()
    expect(second.status).toBe('paused')
    expect(second.checkpoint?.nextPageNumber).toBe(3)
    expect(second.checkpoint?.shards.map((shard) => shard.pageNumber)).toEqual([1, 2])
    expect(second.checkpoint?.nextMarker).not.toBeNull()
    const secondMarker = markerText(second.checkpoint?.nextMarker)
    expect(secondMarker).not.toBe(firstMarker)
    expect(beginCount).toBe(1)
    expect(activationCount).toBe(0)
    expect(objects.shardKeys).toEqual([
      `${identity.objectPrefix}/shards/page-00000001.json.gz`,
      `${identity.objectPrefix}/shards/page-00000002.json.gz`,
    ])

    const artifact = {
      schema_version: 1,
      observed_at: network.observedAt,
      endpoint: network.endpoint,
      ledger: network.validatedLedger,
      snapshot_id: identity.snapshotId,
      first_batch: {
        status: first.status,
        next_page_number: first.checkpoint?.nextPageNumber,
        marker: firstMarker,
        metrics: first.checkpoint?.metrics,
        shard: first.checkpoint?.shards[0],
      },
      resumed_batch: {
        status: second.status,
        next_page_number: second.checkpoint?.nextPageNumber,
        marker: secondMarker,
        metrics: second.checkpoint?.metrics,
        shards: second.checkpoint?.shards,
      },
      assertions: {
        same_ledger: true,
        marker_advanced: firstMarker !== secondMarker,
        page_sequence_preserved: true,
        begin_called_once: beginCount === 1,
        partial_scan_not_activated: activationCount === 0,
      },
    }
    await writeArtifact(artifact)
    console.info(`BOOTSTRAP_RESUME_PREVIEW=${JSON.stringify(artifact)}`)
  }, 180_000)
})
