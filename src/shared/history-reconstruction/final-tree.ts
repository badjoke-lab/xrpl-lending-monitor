import {
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  reconstructionSegmentRange,
} from './identity'

const SEGMENT_FILE = /^(manifest\.json|ledgers\.ndjson\.gz|protocol-events\.ndjson\.gz|object-changes\.ndjson\.gz|loan-lifecycle\.ndjson\.gz|archived-objects\.ndjson\.gz|balance-history\.ndjson\.gz|current-projection-mutations\.ndjson\.gz)$/
const SEGMENT_PATH = /^history\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/([^/]+)$/
const EXACT_PATH = /^history\/index\/exact\/(manifest\.json|\d{4}\.ndjson\.gz)$/
const REQUIRED_SEGMENT_FILES = new Set([
  'manifest.json', 'ledgers.ndjson.gz', 'protocol-events.ndjson.gz', 'object-changes.ndjson.gz',
  'loan-lifecycle.ndjson.gz', 'archived-objects.ndjson.gz', 'balance-history.ndjson.gz',
  'current-projection-mutations.ndjson.gz',
])

export interface FinalTreeEntry {
  path: string
  sha256: string
}

export function assertProductionHistoryPath(path: string): void {
  if (path === 'history-channel.json' || path === 'history/publication.json') return
  const segment = SEGMENT_PATH.exec(path)
  if (segment && SEGMENT_FILE.test(segment[1]!)) return
  if (EXACT_PATH.test(path)) return
  throw new Error(`Unsafe or non-canonical final history path: ${path}`)
}

export function planFinalTree(entries: readonly FinalTreeEntry[]): FinalTreeEntry[] {
  const paths = new Set<string>()
  const result = entries.map((entry) => {
    assertProductionHistoryPath(entry.path)
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid digest for ${entry.path}`)
    if (paths.has(entry.path)) throw new Error(`Duplicate final history path: ${entry.path}`)
    paths.add(entry.path)
    return { ...entry }
  }).sort((left, right) => left.path.localeCompare(right.path))
  for (const required of ['history-channel.json', 'history/publication.json', 'history/index/exact/manifest.json']) {
    if (!paths.has(required)) throw new Error(`Final history tree is missing ${required}`)
  }
  const buckets = result.filter((entry) => /^history\/index\/exact\/\d{4}\.ndjson\.gz$/.test(entry.path))
  if (buckets.length !== 256) throw new Error('Final history tree must contain exactly 256 exact-index buckets')
  const bucketIds = new Set(buckets.map((entry) => Number(entry.path.slice(-14, -10))))
  if (bucketIds.size !== 256 || [...bucketIds].some((bucket) => bucket < 0 || bucket > 255)) {
    throw new Error('Final history tree exact-index bucket IDs must be exactly 0000 through 0255')
  }
  for (let bucket = 0; bucket < 256; bucket += 1) {
    const expected = `history/index/exact/${String(bucket).padStart(4, '0')}.ndjson.gz`
    if (!paths.has(expected)) throw new Error(`Final history tree is missing exact-index bucket ${bucket}`)
  }
  const segmentFiles = new Map<string, Set<string>>()
  for (const entry of result) {
    if (EXACT_PATH.test(entry.path)) continue
    const match = SEGMENT_PATH.exec(entry.path)
    if (!match) continue
    const directory = entry.path.slice(0, entry.path.lastIndexOf('/'))
    segmentFiles.set(directory, new Set([...(segmentFiles.get(directory) ?? []), match[1]!]))
  }
  for (const [directory, files] of segmentFiles) {
    if (!directory.startsWith(`history/${HISTORY_RECONSTRUCTION_EPOCH_ID}/`)) {
      throw new Error(`Final history segment uses the wrong reconstruction epoch: ${directory}`)
    }
    if (files.size !== REQUIRED_SEGMENT_FILES.size || [...REQUIRED_SEGMENT_FILES].some((file) => !files.has(file))) {
      throw new Error(`Final history segment is incomplete: ${directory}`)
    }
  }
  const expectedSegmentDirectories = new Set<string>()
  for (let id = 0; id < HISTORY_RECONSTRUCTION_SEGMENT_COUNT; id += 1) {
    const range = reconstructionSegmentRange(id)
    const segmentId = `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${range.startLedgerIndex}-${range.endLedgerIndex}`
    expectedSegmentDirectories.add(`history/${HISTORY_RECONSTRUCTION_EPOCH_ID}/${segmentId}`)
  }
  for (const directory of expectedSegmentDirectories) {
    if (!segmentFiles.has(directory)) throw new Error(`Final history tree is missing reconstruction segment: ${directory}`)
  }
  return result
}
