import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFile,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'

import { extractHistoryExactEntries } from '../src/shared/history-segments/exact-index-entries'
import {
  assertHistoryExactIndexManifest,
  assertHistoryExactIndexRecord,
  historyExactIndexManifestDigest,
  type HistoryExactIndexAsset,
  type HistoryExactIndexManifest,
  type HistoryExactIndexRecord,
} from '../src/shared/history-segments/exact-index'
import {
  assertHistorySegmentManifest,
  HISTORY_SEGMENT_FILE_KINDS,
  type HistorySegmentFileKind,
  type HistorySegmentManifest,
} from '../src/shared/history-segments/manifest'
import {
  assertHistorySegmentPublicationDigest,
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from '../src/shared/history-segments/publication'
import {
  canonicalJson,
  gzipDeterministic,
  sha256Hex,
  utf8,
} from '../src/shared/current-state/canonical-json'
import { planExactSpill, splitExactSuperBuckets } from '../src/shared/history-reconstruction/exact-spill'
import { planFinalTree, type FinalTreeEntry } from '../src/shared/history-reconstruction/final-tree'
import {
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  HISTORY_RECONSTRUCTION_START_LEDGER,
  HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT,
  HISTORY_RECONSTRUCTION_TARGET_HASH,
  HISTORY_RECONSTRUCTION_TARGET_LEDGER,
  reconstructionSegmentRange,
} from '../src/shared/history-reconstruction/identity'
import { discoverResume } from '../src/shared/history-reconstruction/resume'
import {
  assertAttempt,
  assertRawCheckpoint,
  assertSpillShardEvidence,
  assertSuperBucketEvidence,
  type RawCheckpoint,
  type ReconstructionAttempt,
  type SpillShardEvidence,
  type SuperBucketEvidence,
} from '../src/shared/history-reconstruction/schema'
import {
  assertCompleteCheckpointPrefix,
  buildRawCheckpoint,
  checkpointFileName,
  committedCheckpointFiles,
  rawCheckpointDigest,
  sortExactIndexRecords,
  spillShardRange,
  type ReconstructionPredecessor,
} from '../src/shared/history-reconstruction/runner'

const run = promisify(execFile)
const unzip = promisify(gunzip)
const WITNESS = {
  ledgerIndex: 3_913_030,
  transactionHash: '70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684',
  objectId: 'AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1',
}
const INDEXABLE = new Set<HistorySegmentFileKind>([
  'protocol_events', 'object_changes', 'loan_lifecycle', 'archived_objects', 'balance_history',
])

interface Arguments {
  endpoint: string
  outputDir: string
  sourceRevision: string
  segmentRunner: string
  readWindowSize: number
  maxSegments: number
}

function value(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const result = args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value`)
  return result
}

function positiveInteger(args: readonly string[], name: string, fallback: number): number {
  const raw = value(args, name)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('Immutable history reconstruction requires --local')
  const sourceRevision = value(args, '--source-revision') ?? process.env.GITHUB_SHA ?? ''
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('--source-revision must be a 40-character lowercase Git commit SHA')
  const readWindowSize = positiveInteger(args, '--read-window-size', 16)
  if (readWindowSize > 16) throw new Error('--read-window-size may be at most 16')
  const maxSegments = positiveInteger(args, '--max-segments', HISTORY_RECONSTRUCTION_SEGMENT_COUNT)
  if (maxSegments > HISTORY_RECONSTRUCTION_SEGMENT_COUNT) throw new Error('--max-segments exceeds the fixed reconstruction plan')
  const outputDir = resolve(value(args, '--output-dir') ?? '.local/history-reconstruction')
  if (outputDir === resolve('.') || outputDir.includes(`${join('', '.git')}`)) throw new Error('--output-dir is unsafe')
  return {
    endpoint: value(args, '--endpoint') ?? 'https://clio.devnet.rippletest.net:51234/',
    outputDir,
    sourceRevision,
    segmentRunner: resolve(value(args, '--segment-runner') ?? '.history-segment-build/run-history-segment.mjs'),
    readWindowSize,
    maxSegments,
  }
}

function segmentIdentity(id: number): string {
  const range = reconstructionSegmentRange(id)
  return `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${range.startLedgerIndex}-${range.endLedgerIndex}`
}

function segmentDirectory(outputDir: string, id: number): string {
  return join(outputDir, 'candidate', 'history', HISTORY_RECONSTRUCTION_EPOCH_ID, segmentIdentity(id))
}

function checkpointPath(outputDir: string, id: number): string {
  return join(outputDir, 'checkpoints', checkpointFileName(id))
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writeAtomic(path: string, bytes: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, bytes)
  await rename(temporary, path)
}

async function writeExclusiveCanonical(path: string, valueToWrite: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const text = `${canonicalJson(valueToWrite)}\n`
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, text, 'utf8')
  try {
    await link(temporary, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(path, 'utf8')
    if (existing !== text) throw new Error(`Conflicting immutable evidence already exists: ${path}`)
  } finally {
    await rm(temporary, { force: true })
  }
}

function parseNdjson(text: string): unknown[] {
  const trimmed = text.trimEnd()
  return trimmed.length === 0 ? [] : trimmed.split('\n').map((line) => JSON.parse(line))
}

async function verifySegmentDirectory(path: string, expectedId: number): Promise<{
  manifest: HistorySegmentManifest
  manifestText: string
}> {
  const manifestText = await readFile(join(path, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestText) as HistorySegmentManifest
  assertHistorySegmentManifest(manifest)
  if (manifest.segmentId !== segmentIdentity(expectedId)) throw new Error(`Segment ${expectedId} manifest identity mismatch`)
  const range = reconstructionSegmentRange(expectedId)
  if (manifest.startLedgerIndex !== range.startLedgerIndex
    || manifest.endLedgerIndex !== range.endLedgerIndex
    || manifest.ledgerCount !== range.ledgerCount) {
    throw new Error(`Segment ${expectedId} manifest range mismatch`)
  }
  for (const file of manifest.files) {
    if (file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').includes('..')) {
      throw new Error(`Unsafe segment file path: ${file.path}`)
    }
    const bytes = new Uint8Array(await readFile(join(path, file.path)))
    if (bytes.byteLength !== file.bytes) throw new Error(`Segment ${expectedId}:${file.kind} byte count mismatch`)
    if (await sha256Hex(bytes) !== file.sha256.toLowerCase()) throw new Error(`Segment ${expectedId}:${file.kind} digest mismatch`)
    const records = parseNdjson(new TextDecoder().decode(await unzip(bytes)))
    if (records.length !== file.records) throw new Error(`Segment ${expectedId}:${file.kind} record count mismatch`)
  }
  return { manifest, manifestText }
}

async function readCheckpoints(outputDir: string): Promise<RawCheckpoint[]> {
  const directory = join(outputDir, 'checkpoints')
  if (!(await exists(directory))) return []
  const files = committedCheckpointFiles(await readdir(directory))
  const checkpoints: RawCheckpoint[] = []
  for (const file of files) {
    const checkpoint = JSON.parse(await readFile(join(directory, file), 'utf8')) as RawCheckpoint
    assertRawCheckpoint(checkpoint)
    if (checkpointFileName(checkpoint.segmentId) !== file) throw new Error(`Checkpoint filename mismatch: ${file}`)
    checkpoints.push(checkpoint)
  }
  const discovery = await discoverResume(checkpoints)
  if (discovery.prefix.length !== checkpoints.length || discovery.rejected.length !== 0) {
    throw new Error('Checkpoint directory is not one complete conflict-free prefix')
  }
  return checkpoints
}

async function writeAttempt(outputDir: string, attempt: ReconstructionAttempt): Promise<void> {
  assertAttempt(attempt)
  await writeAtomic(join(outputDir, 'attempts', `${String(attempt.segmentId).padStart(4, '0')}.json`), `${canonicalJson(attempt)}\n`)
}

async function persistCheckpoint(outputDir: string, checkpoint: RawCheckpoint): Promise<void> {
  assertRawCheckpoint(checkpoint)
  await writeExclusiveCanonical(checkpointPath(outputDir, checkpoint.segmentId), checkpoint)
}

async function completeSegment(options: {
  args: Arguments
  id: number
  checkpoints: RawCheckpoint[]
}): Promise<RawCheckpoint> {
  const predecessorCheckpoint = options.checkpoints.at(-1) ?? null
  const predecessor: ReconstructionPredecessor | null = predecessorCheckpoint
    ? { checkpoint: predecessorCheckpoint, digest: await rawCheckpointDigest(predecessorCheckpoint) }
    : null
  const destination = segmentDirectory(options.args.outputDir, options.id)
  const attemptNumber = Number((JSON.parse(await readFile(
    join(options.args.outputDir, 'attempts', `${String(options.id).padStart(4, '0')}.json`),
    'utf8',
  ).catch(() => '{"attempt":0}')) as { attempt?: number }).attempt ?? 0) + 1
  const baseAttempt = {
    schemaVersion: 1 as const,
    kind: 'immutable-history-attempt' as const,
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    segmentId: options.id,
    attempt: attemptNumber,
    lastSuccessfulLedgerIndex: predecessorCheckpoint?.endLedgerIndex ?? null,
    lastSuccessfulLedgerHash: predecessorCheckpoint?.terminalHash ?? null,
    lastPersistedCheckpointDigest: predecessor?.digest ?? null,
    productionMutation: false as const,
  }
  await writeAttempt(options.args.outputDir, { ...baseAttempt, state: 'started' })
  try {
    if (!(await exists(destination))) {
      const range = reconstructionSegmentRange(options.id)
      const temporary = join(options.args.outputDir, 'work', `segment-${String(options.id).padStart(4, '0')}-${process.pid}-${Date.now()}`)
      await rm(temporary, { recursive: true, force: true })
      await mkdir(temporary, { recursive: true })
      const childArgs = [
        options.args.segmentRunner,
        '--local',
        '--endpoint', options.args.endpoint,
        '--read-window-size', String(options.args.readWindowSize),
        '--start-ledger', String(range.startLedgerIndex),
        '--end-ledger', String(range.endLedgerIndex),
        '--epoch-id', HISTORY_RECONSTRUCTION_EPOCH_ID,
        '--segment-id', segmentIdentity(options.id),
        '--output-dir', temporary,
        '--source-revision', options.args.sourceRevision,
      ]
      if (predecessorCheckpoint) {
        childArgs.push('--previous-segment-id', segmentIdentity(predecessorCheckpoint.segmentId))
        childArgs.push('--previous-segment-end-hash', predecessorCheckpoint.terminalHash)
      }
      await run(process.execPath, childArgs, { maxBuffer: 32 * 1024 * 1024 })
      await verifySegmentDirectory(temporary, options.id)
      await mkdir(dirname(destination), { recursive: true })
      try {
        await rename(temporary, destination)
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(String((error as NodeJS.ErrnoException).code))) throw error
        await verifySegmentDirectory(destination, options.id)
        await rm(temporary, { recursive: true, force: true })
      }
    }
    const verified = await verifySegmentDirectory(destination, options.id)
    const checkpoint = await buildRawCheckpoint({
      segmentId: options.id,
      manifest: verified.manifest,
      manifestText: verified.manifestText,
      sourceImplementationSha: options.args.sourceRevision,
      predecessor,
    })
    await persistCheckpoint(options.args.outputDir, checkpoint)
    await writeAttempt(options.args.outputDir, {
      ...baseAttempt,
      state: 'completed',
      lastSuccessfulLedgerIndex: checkpoint.endLedgerIndex,
      lastSuccessfulLedgerHash: checkpoint.terminalHash,
      lastPersistedCheckpointDigest: await rawCheckpointDigest(checkpoint),
    })
    return checkpoint
  } catch (error) {
    await writeAttempt(options.args.outputDir, { ...baseAttempt, state: 'failed' })
    throw error
  }
}

async function exactInputsForSegment(outputDir: string, id: number): Promise<Omit<HistoryExactIndexRecord, 'bucket'>[]> {
  const { manifest } = await verifySegmentDirectory(segmentDirectory(outputDir, id), id)
  const result: Omit<HistoryExactIndexRecord, 'bucket'>[] = []
  for (const file of manifest.files) {
    if (!INDEXABLE.has(file.kind)) continue
    const bytes = new Uint8Array(await readFile(join(segmentDirectory(outputDir, id), file.path)))
    const records = parseNdjson(new TextDecoder().decode(await unzip(bytes)))
    for (const record of records) {
      const extracted = extractHistoryExactEntries({
        epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
        segmentId: manifest.segmentId,
        fileKind: file.kind,
        value: record,
      })
      if (!extracted) continue
      for (const term of extracted.terms) {
        result.push({ schemaVersion: 2, term, reference: extracted.reference })
      }
    }
  }
  return result
}

function shardDirectory(outputDir: string, shardId: number): string {
  return join(outputDir, 'spill', `shard-${String(shardId).padStart(2, '0')}`)
}

function shardSuperPath(outputDir: string, shardId: number, superBucket: number): string {
  return join(shardDirectory(outputDir, shardId), `super-${String(superBucket).padStart(2, '0')}.ndjson`)
}

async function fileSetDigest(paths: readonly string[]): Promise<string> {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(`${path.split('/').at(-1)}\0`)
    hash.update(await readFile(path))
  }
  return hash.digest('hex')
}

async function verifySpillShard(outputDir: string, shardId: number): Promise<SpillShardEvidence> {
  const directory = shardDirectory(outputDir, shardId)
  const evidence = JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8')) as SpillShardEvidence
  assertSpillShardEvidence(evidence)
  if (evidence.shardId !== shardId) throw new Error(`Spill shard ${shardId} evidence identity mismatch`)
  const paths = Array.from({ length: HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT }, (_, superBucket) => (
    shardSuperPath(outputDir, shardId, superBucket)
  ))
  if (await fileSetDigest(paths) !== evidence.digest) throw new Error(`Spill shard ${shardId} output digest mismatch`)
  let records = 0
  for (const path of paths) records += parseNdjson(await readFile(path, 'utf8')).length
  if (records !== evidence.recordCount) throw new Error(`Spill shard ${shardId} record count mismatch`)
  return evidence
}

async function buildSpillShard(outputDir: string, shardId: number): Promise<SpillShardEvidence> {
  const directory = shardDirectory(outputDir, shardId)
  if (await exists(join(directory, 'evidence.json'))) return verifySpillShard(outputDir, shardId)
  const range = spillShardRange(shardId)
  const temporary = join(outputDir, 'work', `shard-${String(shardId).padStart(2, '0')}-${process.pid}-${Date.now()}`)
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  const rawHash = createHash('sha256')
  let recordCount = 0
  for (let id = range.firstSegmentId; id <= range.lastSegmentId; id += 1) {
    const inputs = await exactInputsForSegment(outputDir, id)
    for (const input of inputs) rawHash.update(`${canonicalJson(input)}\n`)
    const planned = await planExactSpill(inputs)
    const split = splitExactSuperBuckets(planned)
    for (let superBucket = 0; superBucket < HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT; superBucket += 1) {
      const records = split.get(superBucket) ?? []
      if (records.length > 0) {
        await appendFile(
          join(temporary, `super-${String(superBucket).padStart(2, '0')}.ndjson`),
          `${records.map((record) => canonicalJson(record)).join('\n')}\n`,
        )
      }
    }
    recordCount += planned.length
  }
  const paths: string[] = []
  for (let superBucket = 0; superBucket < HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT; superBucket += 1) {
    const path = join(temporary, `super-${String(superBucket).padStart(2, '0')}.ndjson`)
    if (!(await exists(path))) await writeFile(path, '')
    paths.push(path)
  }
  const evidence: SpillShardEvidence = {
    schemaVersion: 1,
    kind: 'history-exact-spill-shard',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    shardId,
    rawInputDigest: rawHash.digest('hex'),
    firstSegmentId: range.firstSegmentId,
    lastSegmentId: range.lastSegmentId,
    superBucketCount: 16,
    recordCount,
    digest: await fileSetDigest(paths),
    productionMutation: false,
  }
  assertSpillShardEvidence(evidence)
  await writeFile(join(temporary, 'evidence.json'), `${canonicalJson(evidence)}\n`)
  await mkdir(dirname(directory), { recursive: true })
  try {
    await rename(temporary, directory)
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes(String((error as NodeJS.ErrnoException).code))) throw error
    await rm(temporary, { recursive: true, force: true })
  }
  return verifySpillShard(outputDir, shardId)
}

function exactDirectory(outputDir: string): string {
  return join(outputDir, 'candidate', 'history', 'index', 'exact')
}

async function buildSuperBucket(outputDir: string, superBucket: number): Promise<SuperBucketEvidence> {
  if (!Number.isSafeInteger(superBucket) || superBucket < 0 || superBucket >= 16) throw new Error('Super-bucket ID is invalid')
  const evidencePath = join(outputDir, 'super-buckets', `${String(superBucket).padStart(2, '0')}.json`)
  const firstBucket = superBucket * 16
  const finalPaths = Array.from({ length: 16 }, (_, offset) => (
    join(exactDirectory(outputDir), `${String(firstBucket + offset).padStart(4, '0')}.ndjson.gz`)
  ))
  if (await exists(evidencePath)) {
    const existing = JSON.parse(await readFile(evidencePath, 'utf8')) as SuperBucketEvidence
    assertSuperBucketEvidence(existing)
    if (existing.superBucket !== superBucket || await fileSetDigest(finalPaths) !== existing.digest) {
      throw new Error(`Super-bucket ${superBucket} evidence mismatch`)
    }
    return existing
  }
  const temporary = join(outputDir, 'work', `super-${String(superBucket).padStart(2, '0')}-${process.pid}-${Date.now()}`)
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  const inputHash = createHash('sha256')
  let recordCount = 0
  for (let shardId = 0; shardId < 33; shardId += 1) {
    await verifySpillShard(outputDir, shardId)
    const sourcePath = shardSuperPath(outputDir, shardId, superBucket)
    const source = await readFile(sourcePath, 'utf8')
    inputHash.update(source)
    const grouped = new Map<number, string[]>()
    for (const valueToParse of parseNdjson(source)) {
      const record = valueToParse as HistoryExactIndexRecord
      assertHistoryExactIndexRecord(record, 256)
      if (Math.floor(record.bucket / 16) !== superBucket) throw new Error('Spill record super-bucket mismatch')
      grouped.set(record.bucket, [...(grouped.get(record.bucket) ?? []), canonicalJson(record)])
      recordCount += 1
    }
    for (const [bucket, lines] of grouped) {
      await appendFile(join(temporary, `${String(bucket).padStart(4, '0')}.ndjson`), `${lines.join('\n')}\n`)
    }
  }
  await mkdir(exactDirectory(outputDir), { recursive: true })
  for (let bucket = firstBucket; bucket < firstBucket + 16; bucket += 1) {
    const plainPath = join(temporary, `${String(bucket).padStart(4, '0')}.ndjson`)
    const source = await readFile(plainPath, 'utf8').catch(() => '')
    const records = sortExactIndexRecords(parseNdjson(source) as HistoryExactIndexRecord[])
    if (records.some((record) => record.bucket !== bucket)) throw new Error(`Exact bucket ${bucket} contains a foreign record`)
    const text = records.length > 0 ? `${records.map((record) => canonicalJson(record)).join('\n')}\n` : ''
    await writeFile(join(exactDirectory(outputDir), `${String(bucket).padStart(4, '0')}.ndjson.gz`), await gzipDeterministic(utf8(text)))
  }
  const evidence: SuperBucketEvidence = {
    schemaVersion: 1,
    kind: 'history-exact-super-bucket',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    superBucket,
    rawInputDigest: inputHash.digest('hex'),
    firstBucket,
    lastBucket: firstBucket + 15,
    recordCount,
    digest: await fileSetDigest(finalPaths),
    productionMutation: false,
  }
  assertSuperBucketEvidence(evidence)
  await writeExclusiveCanonical(evidencePath, evidence)
  await rm(temporary, { recursive: true, force: true })
  return evidence
}

async function buildPublication(outputDir: string, checkpoints: readonly RawCheckpoint[], sourceRevision: string): Promise<HistorySegmentChainPublication> {
  const segments: PublishedHistorySegment[] = []
  const manifests: HistorySegmentManifest[] = []
  for (const checkpoint of checkpoints) {
    const { manifest } = await verifySegmentDirectory(segmentDirectory(outputDir, checkpoint.segmentId), checkpoint.segmentId)
    manifests.push(manifest)
    const recordCounts = Object.fromEntries(HISTORY_SEGMENT_FILE_KINDS.map((kind) => [
      kind,
      manifest.files.find((file) => file.kind === kind)!.records,
    ])) as PublishedHistorySegment['recordCounts']
    segments.push({
      segmentId: manifest.segmentId,
      manifestPath: `history/${HISTORY_RECONSTRUCTION_EPOCH_ID}/${manifest.segmentId}/manifest.json`,
      manifestSha256: checkpoint.manifestSha256,
      startLedgerIndex: manifest.startLedgerIndex,
      startLedgerHash: manifest.startLedgerHash,
      startParentHash: manifest.startParentHash,
      endLedgerIndex: manifest.endLedgerIndex,
      endLedgerHash: manifest.endLedgerHash,
      ledgerCount: manifest.ledgerCount,
      previousSegmentId: manifest.previousSegmentId,
      previousSegmentEndHash: manifest.previousSegmentEndHash,
      recordCounts,
    })
  }
  const first = manifests[0]!
  const last = manifests.at(-1)!
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
    chainId: HISTORY_RECONSTRUCTION_ID,
    complete: true,
    startLedgerIndex: HISTORY_RECONSTRUCTION_START_LEDGER,
    startLedgerHash: first.startLedgerHash,
    startParentHash: first.startParentHash,
    endLedgerIndex: HISTORY_RECONSTRUCTION_TARGET_LEDGER,
    endLedgerHash: HISTORY_RECONSTRUCTION_TARGET_HASH,
    segmentCount: HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
    ledgerCount: HISTORY_RECONSTRUCTION_TARGET_LEDGER - HISTORY_RECONSTRUCTION_START_LEDGER + 1,
    sourceRevision,
    publishedAt: last.generatedAt,
    segments,
    publicationSha256: '0'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  await assertHistorySegmentPublicationDigest(publication)
  await writeAtomic(join(outputDir, 'candidate', 'history', 'publication.json'), `${canonicalJson(publication)}\n`)
  return publication
}

async function buildExactManifest(outputDir: string, publication: HistorySegmentChainPublication, sourceRevision: string): Promise<HistoryExactIndexManifest> {
  const assets: HistoryExactIndexAsset[] = []
  let totalRecords = 0
  for (let bucket = 0; bucket < HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT; bucket += 1) {
    const path = join(exactDirectory(outputDir), `${String(bucket).padStart(4, '0')}.ndjson.gz`)
    const bytes = new Uint8Array(await readFile(path))
    const records = parseNdjson(new TextDecoder().decode(await unzip(bytes))) as HistoryExactIndexRecord[]
    for (const record of records) {
      assertHistoryExactIndexRecord(record, 256)
      if (record.bucket !== bucket) throw new Error(`Exact index bucket ${bucket} contains a foreign record`)
    }
    const sorted = sortExactIndexRecords(records)
    if (canonicalJson(sorted) !== canonicalJson(records)) throw new Error(`Exact index bucket ${bucket} is not canonically sorted`)
    assets.push({
      bucket,
      path: `history/index/exact/${String(bucket).padStart(4, '0')}.ndjson.gz`,
      sha256: await sha256Hex(bytes),
      compressedBytes: bytes.byteLength,
      recordCount: records.length,
      firstTerm: records[0]?.term ?? null,
      lastTerm: records.at(-1)?.term ?? null,
    })
    totalRecords += records.length
  }
  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 2,
    network: 'devnet',
    epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
    chainId: publication.chainId,
    publicationSha256: publication.publicationSha256,
    bucketCount: 256,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords,
    sourceRevision,
    generatedAt: publication.publishedAt,
    manifestSha256: '0'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  assertHistoryExactIndexManifest(manifest, publication)
  await writeAtomic(join(exactDirectory(outputDir), 'manifest.json'), `${canonicalJson(manifest)}\n`)
  return manifest
}

async function verifyWitness(outputDir: string): Promise<void> {
  const id = 224
  const { manifest } = await verifySegmentDirectory(segmentDirectory(outputDir, id), id)
  let transactionFound = false
  let objectFound = false
  for (const file of manifest.files) {
    if (!['protocol_events', 'object_changes'].includes(file.kind)) continue
    const bytes = new Uint8Array(await readFile(join(segmentDirectory(outputDir, id), file.path)))
    const records = parseNdjson(new TextDecoder().decode(await unzip(bytes))) as Record<string, unknown>[]
    if (file.kind === 'protocol_events') {
      transactionFound ||= records.some((record) => record.ledgerIndex === WITNESS.ledgerIndex && record.eventHash === WITNESS.transactionHash)
    }
    if (file.kind === 'object_changes') {
      objectFound ||= records.some((record) => record.ledgerIndex === WITNESS.ledgerIndex
        && record.transactionHash === WITNESS.transactionHash
        && record.objectId === WITNESS.objectId)
    }
  }
  if (!transactionFound || !objectFound) throw new Error('Fixed Vault witness is absent from reconstructed segment 224')
}

async function enumerateFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = []
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    if ((await stat(path)).isDirectory()) result.push(...await enumerateFiles(root, path))
    else result.push(relative(root, path).replaceAll('\\', '/'))
  }
  return result
}

async function finalizeCandidate(outputDir: string, checkpoints: readonly RawCheckpoint[], sourceRevision: string): Promise<void> {
  await assertCompleteCheckpointPrefix(checkpoints)
  if (checkpoints.at(-1)?.terminalHash !== HISTORY_RECONSTRUCTION_TARGET_HASH) {
    throw new Error('Raw reconstruction terminal hash mismatch')
  }
  await verifyWitness(outputDir)
  for (let shardId = 0; shardId < 33; shardId += 1) await buildSpillShard(outputDir, shardId)
  for (let superBucket = 0; superBucket < HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT; superBucket += 1) {
    await buildSuperBucket(outputDir, superBucket)
  }
  const publication = await buildPublication(outputDir, checkpoints, sourceRevision)
  const exactManifest = await buildExactManifest(outputDir, publication, sourceRevision)
  const channel = {
    schemaVersion: 1,
    active: {
      dataCommitSha: sourceRevision,
      publicationPath: 'history/publication.json',
      publicationSha256: await sha256Hex(utf8(`${canonicalJson(publication)}\n`)),
      chainId: publication.chainId,
      epochId: publication.epochId,
      exactIndex: {
        manifestPath: 'history/index/exact/manifest.json',
        manifestSha256: await sha256Hex(utf8(`${canonicalJson(exactManifest)}\n`)),
      },
    },
    updatedAt: publication.publishedAt,
  }
  await writeAtomic(join(outputDir, 'candidate', 'history-channel.json'), `${canonicalJson(channel)}\n`)
  const candidateRoot = join(outputDir, 'candidate')
  const entries: FinalTreeEntry[] = []
  for (const path of await enumerateFiles(candidateRoot)) {
    entries.push({ path, sha256: await sha256Hex(new Uint8Array(await readFile(join(candidateRoot, path)))) })
  }
  const tree = planFinalTree(entries)
  await writeAtomic(join(outputDir, 'evidence', 'final-tree.json'), `${canonicalJson({
    schemaVersion: 1,
    kind: 'history-reconstruction-candidate-tree',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    entries: tree,
    witnessPassed: true,
    remoteRehearsalPassed: false,
    productionMutation: false,
  })}\n`)
}

async function writeSummary(options: {
  outputDir: string
  checkpoints: readonly RawCheckpoint[]
  status: 'incomplete' | 'candidate-ready'
  failure?: string
}): Promise<void> {
  const discovery = await discoverResume(options.checkpoints)
  await writeAtomic(join(options.outputDir, 'summary.json'), `${canonicalJson({
    schemaVersion: 1,
    kind: 'immutable-history-reconstruction-run',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    status: options.status,
    completedSegments: options.checkpoints.length,
    nextSegmentId: discovery.nextSegmentId,
    targetLedgerIndex: HISTORY_RECONSTRUCTION_TARGET_LEDGER,
    targetLedgerHash: HISTORY_RECONSTRUCTION_TARGET_HASH,
    failure: options.failure ?? null,
    productionMutation: false,
  })}\n`)
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  await mkdir(args.outputDir, { recursive: true })
  let checkpoints = await readCheckpoints(args.outputDir)
  const discovery = await discoverResume(checkpoints)
  let next = discovery.nextSegmentId
  let processed = 0
  while (next !== null && processed < args.maxSegments) {
    const checkpoint = await completeSegment({ args, id: next, checkpoints })
    checkpoints = [...checkpoints, checkpoint]
    next = checkpoints.length === HISTORY_RECONSTRUCTION_SEGMENT_COUNT ? null : checkpoints.length
    processed += 1
  }
  if (next !== null) {
    await writeSummary({ outputDir: args.outputDir, checkpoints, status: 'incomplete' })
    process.stdout.write(`${canonicalJson({ status: 'incomplete', completedSegments: checkpoints.length, nextSegmentId: next })}\n`)
    return
  }
  await finalizeCandidate(args.outputDir, checkpoints, args.sourceRevision)
  await writeSummary({ outputDir: args.outputDir, checkpoints, status: 'candidate-ready' })
  process.stdout.write(`${canonicalJson({ status: 'candidate-ready', completedSegments: checkpoints.length, productionMutation: false })}\n`)
}

try {
  await main()
} catch (error) {
  const failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const args = parseArguments(process.argv.slice(2))
  const checkpoints = await readCheckpoints(args.outputDir).catch(() => [])
  await writeSummary({ outputDir: args.outputDir, checkpoints, status: 'incomplete', failure }).catch(() => undefined)
  throw error
}
