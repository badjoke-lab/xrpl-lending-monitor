import { createHash } from 'node:crypto'
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'

import { canonicalJson, sha256Hex } from '../../src/shared/current-state/canonical-json'
import {
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from '../../src/shared/history-segments/manifest'
import {
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  reconstructionSegmentRange,
} from '../../src/shared/history-reconstruction/identity'
import { checkpointFileName } from '../../src/shared/history-reconstruction/runner'

const unzip = promisify(gunzip)

export interface ReconstructionRuntimeOptions {
  endpoint: string
  outputDir: string
  sourceRevision: string
  segmentRunner: string
  readWindowSize: number
  maxSegments: number
}

export function segmentIdentity(id: number): string {
  const range = reconstructionSegmentRange(id)
  return `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${range.startLedgerIndex}-${range.endLedgerIndex}`
}

export function segmentDirectory(outputDir: string, id: number): string {
  return join(outputDir, 'candidate', 'history', HISTORY_RECONSTRUCTION_EPOCH_ID, segmentIdentity(id))
}

export function checkpointPath(outputDir: string, id: number): string {
  return join(outputDir, 'checkpoints', checkpointFileName(id))
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function writeAtomic(path: string, bytes: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, bytes)
  await rename(temporary, path)
}

export async function writeExclusiveCanonical(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const text = `${canonicalJson(value)}\n`
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, text, 'utf8')
  try {
    await link(temporary, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (await readFile(path, 'utf8') !== text) {
      throw new Error(`Conflicting immutable evidence already exists: ${path}`)
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export function parseNdjson(text: string): unknown[] {
  const trimmed = text.trimEnd()
  return trimmed.length === 0 ? [] : trimmed.split('\n').map((line) => JSON.parse(line))
}

export async function verifySegmentDirectory(path: string, id: number): Promise<{
  manifest: HistorySegmentManifest
  manifestText: string
}> {
  const manifestText = await readFile(join(path, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestText) as HistorySegmentManifest
  assertHistorySegmentManifest(manifest)
  const range = reconstructionSegmentRange(id)
  if (manifest.segmentId !== segmentIdentity(id)
    || manifest.startLedgerIndex !== range.startLedgerIndex
    || manifest.endLedgerIndex !== range.endLedgerIndex
    || manifest.ledgerCount !== range.ledgerCount) {
    throw new Error(`Segment ${id} fixed identity mismatch`)
  }
  for (const file of manifest.files) {
    if (file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').includes('..')) {
      throw new Error(`Unsafe segment file path: ${file.path}`)
    }
    const bytes = new Uint8Array(await readFile(join(path, file.path)))
    if (bytes.byteLength !== file.bytes) throw new Error(`Segment ${id}:${file.kind} byte count mismatch`)
    if (await sha256Hex(bytes) !== file.sha256.toLowerCase()) throw new Error(`Segment ${id}:${file.kind} digest mismatch`)
    if (parseNdjson(new TextDecoder().decode(await unzip(bytes))).length !== file.records) {
      throw new Error(`Segment ${id}:${file.kind} record count mismatch`)
    }
  }
  return { manifest, manifestText }
}

export async function fileSetDigest(paths: readonly string[]): Promise<string> {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(`${path.split('/').at(-1)}\0`)
    hash.update(await readFile(path))
  }
  return hash.digest('hex')
}

export async function enumerateFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = []
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    if ((await stat(path)).isDirectory()) result.push(...await enumerateFiles(root, path))
    else result.push(relative(root, path).replaceAll('\\', '/'))
  }
  return result
}
