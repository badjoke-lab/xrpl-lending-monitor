import { canonicalJson, sha256Hex, utf8 } from './canonical-json'
import type { ArtifactStore } from './artifact-metadata'
import type { ArtifactBootstrapCheckpoint } from './artifact-bootstrap-types'
import type { PageArtifactManifest } from './page-artifact-types'
import {
  buildSnapshotCatalogArtifacts,
  type SnapshotCatalogArtifact,
  type SnapshotCatalogDescriptor,
} from './snapshot-catalog'
import type { SnapshotIdentity } from './snapshot-types'

export interface SnapshotLevelManifest {
  schemaVersion: 2
  identity: SnapshotIdentity
  generatedAt: string
  pageCount: number
  metrics: ArtifactBootstrapCheckpoint['metrics']
  pages: ArtifactBootstrapCheckpoint['pageManifests']
  catalogs: SnapshotCatalogDescriptor[]
  totals: {
    dataObjects: number
    indexEntries: number
    uncompressedBytes: number
    compressedBytes: number
  }
  catalogTotals: {
    entries: number
    uncompressedBytes: number
    compressedBytes: number
  }
}

export interface SnapshotLevelArtifact {
  manifest: SnapshotLevelManifest
  catalogArtifacts: SnapshotCatalogArtifact[]
  key: string
  bytes: Uint8Array
  sha256: string
}

function prefix(identity: SnapshotIdentity): string {
  return `current-state/${identity.network}/${identity.epochId}/${identity.snapshotId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertIdentity(expected: SnapshotIdentity, actual: unknown): void {
  if (!isRecord(actual)) throw new Error('Page manifest identity is invalid')
  for (const field of ['network', 'epochId', 'snapshotId', 'ledgerIndex', 'ledgerHash'] as const) {
    if (actual[field] !== expected[field]) throw new Error(`Page manifest identity mismatch for ${field}`)
  }
}

function parsePageManifest(bytes: Uint8Array): PageArtifactManifest {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error('Page manifest schema is invalid')
  }
  if (!Number.isSafeInteger(parsed.pageSequence) || Number(parsed.pageSequence) < 1) {
    throw new Error('Page manifest sequence is invalid')
  }
  if (!isRecord(parsed.totals)) throw new Error('Page manifest totals are invalid')
  for (const field of ['dataObjects', 'indexEntries', 'uncompressedBytes', 'compressedBytes'] as const) {
    const value = parsed.totals[field]
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
      throw new Error(`Page manifest total ${field} is invalid`)
    }
  }
  return parsed as unknown as PageArtifactManifest
}

async function loadPageManifests(options: {
  store: ArtifactStore
  checkpoint: ArtifactBootstrapCheckpoint
}): Promise<PageArtifactManifest[]> {
  const pages: PageArtifactManifest[] = []
  for (const [index, reference] of options.checkpoint.pageManifests.entries()) {
    const expectedSequence = index + 1
    if (reference.pageSequence !== expectedSequence) {
      throw new Error('Snapshot page manifest sequence is not contiguous')
    }
    const bytes = await options.store.read(reference.key)
    if (!bytes) throw new Error(`Missing page manifest ${reference.key}`)
    if (await sha256Hex(bytes) !== reference.sha256) {
      throw new Error(`Page manifest digest mismatch for ${reference.key}`)
    }
    const manifest = parsePageManifest(bytes)
    if (manifest.pageSequence !== reference.pageSequence) {
      throw new Error(`Page manifest sequence mismatch for ${reference.key}`)
    }
    assertIdentity(options.checkpoint, manifest.identity)
    pages.push(manifest)
  }
  return pages
}

async function persistCatalogs(
  store: ArtifactStore,
  artifacts: readonly SnapshotCatalogArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    await store.write(artifact.key, artifact.bytes, artifact.sha256)
    const stored = await store.inspect(artifact.key)
    if (!stored || stored.size !== artifact.bytes.byteLength || stored.sha256 !== artifact.sha256) {
      throw new Error(`Snapshot catalog persistence verification failed for ${artifact.key}`)
    }
  }
}

export async function buildAndPersistSnapshotLevelManifest(options: {
  store: ArtifactStore
  checkpoint: ArtifactBootstrapCheckpoint
  generatedAt: string
}): Promise<SnapshotLevelArtifact> {
  if (!options.checkpoint.scanComplete) {
    throw new Error('Snapshot manifest requires a complete bootstrap checkpoint')
  }
  if (options.checkpoint.nextPageSequence !== options.checkpoint.pageManifests.length + 1) {
    throw new Error('Snapshot checkpoint sequence does not match page manifests')
  }
  if (options.checkpoint.metrics.pages !== options.checkpoint.pageManifests.length) {
    throw new Error('Snapshot checkpoint page count does not match page manifests')
  }

  const pages = await loadPageManifests(options)
  const identity: SnapshotIdentity = {
    network: options.checkpoint.network,
    epochId: options.checkpoint.epochId,
    snapshotId: options.checkpoint.snapshotId,
    ledgerIndex: options.checkpoint.ledgerIndex,
    ledgerHash: options.checkpoint.ledgerHash,
  }
  const catalogArtifacts = await buildSnapshotCatalogArtifacts({ identity, pages })
  await persistCatalogs(options.store, catalogArtifacts)

  const totals = pages.reduce((result, page) => ({
    dataObjects: result.dataObjects + page.totals.dataObjects,
    indexEntries: result.indexEntries + page.totals.indexEntries,
    uncompressedBytes: result.uncompressedBytes + page.totals.uncompressedBytes,
    compressedBytes: result.compressedBytes + page.totals.compressedBytes,
  }), { dataObjects: 0, indexEntries: 0, uncompressedBytes: 0, compressedBytes: 0 })
  const catalogs = catalogArtifacts.map(({ bytes: _bytes, ...descriptor }) => descriptor)
  const catalogTotals = catalogs.reduce((result, catalog) => ({
    entries: result.entries + catalog.entryCount,
    uncompressedBytes: result.uncompressedBytes + catalog.uncompressedBytes,
    compressedBytes: result.compressedBytes + catalog.compressedBytes,
  }), { entries: 0, uncompressedBytes: 0, compressedBytes: 0 })

  const manifest: SnapshotLevelManifest = {
    schemaVersion: 2,
    identity,
    generatedAt: options.generatedAt,
    pageCount: pages.length,
    metrics: options.checkpoint.metrics,
    pages: options.checkpoint.pageManifests,
    catalogs,
    totals,
    catalogTotals,
  }
  const bytes = utf8(`${canonicalJson(manifest)}\n`)
  const sha256 = await sha256Hex(bytes)
  const key = `${prefix(manifest.identity)}/manifest.json`
  await options.store.write(key, bytes, sha256)
  const stored = await options.store.inspect(key)
  if (!stored || stored.size !== bytes.byteLength || stored.sha256 !== sha256) {
    throw new Error('Snapshot manifest persistence verification failed')
  }
  return { manifest, catalogArtifacts, key, bytes, sha256 }
}
