import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import type { ArtifactMetadata, ArtifactStore } from '../../shared/current-state/artifact-metadata'
import { verifyArtifact } from '../../shared/current-state/artifact-metadata'
import type {
  ArtifactBootstrapCheckpoint,
  ArtifactBootstrapCheckpointStore,
} from '../../shared/current-state/artifact-bootstrap-types'
import { sha256Hex } from '../../shared/current-state/canonical-json'

function safeArtifactPath(root: string, key: string): string {
  if (key.length === 0 || key.includes('\\') || key.includes('\0')) {
    throw new Error('Artifact key is invalid')
  }
  const segments = key.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('Artifact key contains an invalid path segment')
  }
  const path = resolve(root, ...segments)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!path.startsWith(prefix)) throw new Error('Artifact key escapes the storage root')
  return path
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await writeFile(temporary, bytes)
  await rename(temporary, path)
}

async function walkFiles(root: string): Promise<string[]> {
  if (!(await fileExists(root))) return []
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await visit(root)
  return files.sort()
}

export class LocalFileArtifactStore implements ArtifactStore {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async write(key: string, bytes: Uint8Array, sha256: string): Promise<void> {
    await verifyArtifact(bytes, sha256)
    const path = safeArtifactPath(this.root, key)
    if (await fileExists(path)) {
      const existing = new Uint8Array(await readFile(path))
      const existingSha256 = await sha256Hex(existing)
      if (existingSha256 !== sha256) throw new Error(`Immutable artifact mismatch for ${key}`)
      return
    }
    await atomicWrite(path, bytes)
  }

  async read(key: string): Promise<Uint8Array | null> {
    const path = safeArtifactPath(this.root, key)
    if (!(await fileExists(path))) return null
    return new Uint8Array(await readFile(path))
  }

  async inspect(key: string): Promise<ArtifactMetadata | null> {
    const bytes = await this.read(key)
    if (!bytes) return null
    return { key, size: bytes.byteLength, sha256: await sha256Hex(bytes) }
  }

  async enumerate(prefix: string): Promise<ArtifactMetadata[]> {
    const normalizedPrefix = prefix.replace(/\/+$/, '')
    const prefixPath = normalizedPrefix.length === 0
      ? this.root
      : safeArtifactPath(this.root, normalizedPrefix)
    const paths = await walkFiles(prefixPath)
    const metadata: ArtifactMetadata[] = []
    for (const path of paths) {
      const bytes = new Uint8Array(await readFile(path))
      const key = path.slice(this.root.length + 1).split(sep).join('/')
      metadata.push({ key, size: bytes.byteLength, sha256: await sha256Hex(bytes) })
    }
    return metadata.sort((left, right) => left.key.localeCompare(right.key))
  }
}

function checkpointFileName(snapshotId: string): string {
  if (snapshotId.length === 0) throw new Error('snapshotId must not be empty')
  return `${encodeURIComponent(snapshotId)}.json`
}

function parseCheckpoint(value: unknown): ArtifactBootstrapCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Artifact checkpoint must be a JSON object')
  }
  const candidate = value as Partial<ArtifactBootstrapCheckpoint>
  if (candidate.schemaVersion !== 1 || typeof candidate.snapshotId !== 'string') {
    throw new Error('Artifact checkpoint schema is invalid')
  }
  return candidate as ArtifactBootstrapCheckpoint
}

export class LocalFileArtifactBootstrapCheckpointStore
implements ArtifactBootstrapCheckpointStore {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async load(snapshotId: string): Promise<ArtifactBootstrapCheckpoint | null> {
    const path = join(this.root, checkpointFileName(snapshotId))
    if (!(await fileExists(path))) return null
    return parseCheckpoint(JSON.parse(await readFile(path, 'utf8')))
  }

  async save(checkpoint: ArtifactBootstrapCheckpoint): Promise<void> {
    const path = join(this.root, checkpointFileName(checkpoint.snapshotId))
    await atomicWrite(path, `${JSON.stringify(checkpoint, null, 2)}\n`)
  }
}
