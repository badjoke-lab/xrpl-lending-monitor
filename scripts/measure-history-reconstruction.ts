import { execFile } from 'node:child_process'
import { gunzip } from 'node:zlib'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { extractHistoryExactEntries } from '../src/shared/history-segments/exact-index-entries'
import type { HistoryExactIndexRecord } from '../src/shared/history-segments/exact-index'
import { assertHistorySegmentManifest, HISTORY_SEGMENT_FILE_KINDS, type HistorySegmentManifest } from '../src/shared/history-segments/manifest'
import { planExactSpill, splitExactSuperBuckets } from '../src/shared/history-reconstruction/exact-spill'
import { HISTORY_RECONSTRUCTION_ACTIVE_END_HASH, HISTORY_RECONSTRUCTION_EPOCH_ID, HISTORY_RECONSTRUCTION_TARGET_HASH, reconstructionSegmentRange } from '../src/shared/history-reconstruction/identity'
import { assertReadOnlyMeasurementSummary, RECONSTRUCTION_MEASUREMENT_READ_WINDOW_SIZE, RECONSTRUCTION_MEASUREMENT_SEGMENTS } from '../src/shared/history-reconstruction/measurement'
import { appendWithoutArgumentSpread } from './history-reconstruction/append-without-argument-spread.mjs'

const run = promisify(execFile)
const unzip = promisify(gunzip)
const INDEXABLE = new Set(['protocol_events', 'object_changes', 'archived_objects', 'loan_lifecycle', 'balance_history'])
const WITNESS = { ledger: 3_913_030, transactionHash: '70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684', objectId: 'AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1' }

const output = resolve(process.env.MEASUREMENT_OUTPUT ?? 'history-measurement-evidence')
type CompletedMeasurement = { segmentId: number; range: { startLedgerIndex: number; endLedgerIndex: number; ledgerCount: number }; terminalHash: string; semanticCounts: Record<string, number>; compressedBytes: number; [key: string]: unknown }
const measurements: CompletedMeasurement[] = []
let activeSegmentId: number | null = null
let activePhase = 'initialization'

async function main() {
  const endpoint = process.env.XRPL_MEASUREMENT_ENDPOINT
  if (!endpoint) throw new Error('XRPL_MEASUREMENT_ENDPOINT is required')
  await rm(output, { recursive: true, force: true }); await mkdir(join(output, 'segments'), { recursive: true })
  const representativeExactInputs: Omit<HistoryExactIndexRecord, 'bucket'>[] = []
  for (const id of RECONSTRUCTION_MEASUREMENT_SEGMENTS) {
    activeSegmentId = id
    activePhase = 'segment-generation'
    const range = reconstructionSegmentRange(id)
    const segmentId = `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${range.startLedgerIndex}-${range.endLedgerIndex}`
    const directory = join(output, 'segments', String(id).padStart(3, '0'))
    const fetchMetrics = join(directory, 'fetch.json')
    await mkdir(directory, { recursive: true })
    const args = ['scripts/history-reconstruction/measure-segment-wrapper.mjs', '--local', '--endpoint', endpoint, '--read-window-size', String(RECONSTRUCTION_MEASUREMENT_READ_WINDOW_SIZE), '--start-ledger', String(range.startLedgerIndex), '--end-ledger', String(range.endLedgerIndex), '--epoch-id', HISTORY_RECONSTRUCTION_EPOCH_ID, '--segment-id', segmentId, '--output-dir', directory, '--source-revision', process.env.GITHUB_SHA ?? 'local']
    const started = performance.now()
    const execution = await run('/usr/bin/time', ['-v', process.execPath, ...args], { env: { ...process.env, MEASUREMENT_FETCH_METRICS: fetchMetrics }, maxBuffer: 16 * 1024 * 1024 })
    await writeFile(join(directory, 'builder.stdout.log'), execution.stdout)
    await writeFile(join(directory, 'builder.stderr.log'), execution.stderr)
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as HistorySegmentManifest
    activePhase = 'segment-verification'
    assertHistorySegmentManifest(manifest)
    if (manifest.epochId !== HISTORY_RECONSTRUCTION_EPOCH_ID || manifest.startLedgerIndex !== range.startLedgerIndex || manifest.endLedgerIndex !== range.endLedgerIndex || manifest.ledgerCount !== range.ledgerCount) throw new Error(`Incomplete fixed segment ${id}`)
    if (manifest.files.some((file, index) => file.kind !== HISTORY_SEGMENT_FILE_KINDS[index])) throw new Error(`Non-canonical file order in segment ${id}`)
    const previous = measurements.at(-1)
    if (previous && previous.range.endLedgerIndex + 1 === range.startLedgerIndex && manifest.startParentHash !== previous.terminalHash) throw new Error(`Parent-hash discontinuity before segment ${id}`)
    if (id === 0 && manifest.startParentHash !== HISTORY_RECONSTRUCTION_ACTIVE_END_HASH) throw new Error('Segment 000 parent hash does not match the immutable boundary')
    if (id === 262 && manifest.endLedgerHash !== HISTORY_RECONSTRUCTION_TARGET_HASH) throw new Error('Segment 262 terminal hash does not match the fixed target')
    const semantic = { protocolEvents: 0, objectChanges: 0, loanLifecycle: 0, archivedObjects: 0, balanceHistory: 0 }
    const exactInputs: Omit<HistoryExactIndexRecord, 'bucket'>[] = []
    const measuredFiles = []
    let compressedBytes = 0; let decompressedBytes = 0; let witnessTransaction = false; let witnessObject = false
    for (const file of manifest.files) {
      const bytes = await readFile(join(directory, file.path)); const decoded = await unzip(bytes)
      compressedBytes += bytes.byteLength; decompressedBytes += decoded.byteLength
      const records = decoded.length ? decoded.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line)) : []
      if (records.length !== file.records) throw new Error(`Record mismatch ${id}:${file.kind}`)
      measuredFiles.push({ ...file, compressedBytes: bytes.byteLength, decompressedBytes: decoded.byteLength, recordCount: records.length })
      if (file.kind === 'protocol_events') semantic.protocolEvents = records.length
      if (file.kind === 'object_changes') semantic.objectChanges = records.length
      if (file.kind === 'loan_lifecycle') semantic.loanLifecycle = records.length
      if (file.kind === 'archived_objects') semantic.archivedObjects = records.length
      if (file.kind === 'balance_history') semantic.balanceHistory = records.length
      if (INDEXABLE.has(file.kind)) for (const value of records) {
        const extracted = extractHistoryExactEntries({ epochId: HISTORY_RECONSTRUCTION_EPOCH_ID, segmentId, fileKind: file.kind, value })
        if (extracted) for (const term of extracted.terms) exactInputs.push({ schemaVersion: 2 as const, term, reference: extracted.reference })
      }
      if (id === 224) {
        witnessTransaction ||= records.some((record) => record.ledgerIndex === WITNESS.ledger && (record.transactionHash === WITNESS.transactionHash || record.eventHash === WITNESS.transactionHash))
        witnessObject ||= records.some((record) => record.ledgerIndex === WITNESS.ledger && record.transactionHash === WITNESS.transactionHash && record.objectId === WITNESS.objectId)
      }
    }
    if (id === 224 && (!witnessTransaction || !witnessObject)) throw new Error('Fixed segment 224 witness is absent')
    const planned = await planExactSpill(exactInputs); const fetch = JSON.parse(await readFile(fetchMetrics, 'utf8'))
    appendWithoutArgumentSpread(representativeExactInputs, exactInputs)
    const time = execution.stderr
    measurements.push({ segmentId: id, range, firstParentHash: manifest.startParentHash, terminalHash: manifest.endLedgerHash, wallMilliseconds: Math.round(performance.now() - started), cpuUserSeconds: Number(/User time \(seconds\): ([\d.]+)/.exec(time)?.[1] ?? 0), cpuSystemSeconds: Number(/System time \(seconds\): ([\d.]+)/.exec(time)?.[1] ?? 0), peakRssKiB: Number(/Maximum resident set size \(kbytes\): (\d+)/.exec(time)?.[1] ?? 0), endpoint, rpc: fetch, files: measuredFiles, compressedBytes, decompressedBytes, semanticCounts: semantic, exactRecords: planned.length, witness: id === 224 ? { transactionFound: witnessTransaction, objectChangeFound: witnessObject } : null, productionMutation: false })
  }
  activeSegmentId = null
  activePhase = 'exact-index-measurement'
  const exactRssBefore = process.resourceUsage().maxRSS
  const representativeExact = await planExactSpill(representativeExactInputs)
  const exactSuperBuckets = splitExactSuperBuckets(representativeExact)
  const bucketDistribution = Array.from({ length: 256 }, (_, bucket) => representativeExact.filter((entry) => entry.record.bucket === bucket).length)
  const superBucketDistribution = Array.from({ length: 16 }, (_, bucket) => exactSuperBuckets.get(bucket)?.length ?? 0)
  const semanticRecords = measurements.reduce((total, segment) => total + Object.values(segment.semanticCounts).reduce((sum, count) => sum + count, 0), 0)
  const exactIndexMeasurement = {
    extractedRecords: representativeExact.length,
    semanticRecords,
    amplification: semanticRecords === 0 ? null : representativeExact.length / semanticRecords,
    bucketDistribution,
    superBucketDistribution,
    serializedBytes: Buffer.byteLength(representativeExact.map((entry) => JSON.stringify(entry.record)).join('\n')),
    peakRssKiB: Math.max(exactRssBefore, process.resourceUsage().maxRSS),
    productionMutation: false,
  }
  const localGit = resolve(process.env.RUNNER_TEMP ?? '/tmp', 'xrpl-history-measurement-git')
  activePhase = 'local-git-measurement'
  await rm(localGit, { recursive: true, force: true }); await mkdir(localGit, { recursive: true })
  await cp(join(output, 'segments'), join(localGit, 'segments'), { recursive: true })
  await run('git', ['init', '-q'], { cwd: localGit }); await run('git', ['config', 'user.name', 'read-only-measurement'], { cwd: localGit }); await run('git', ['config', 'user.email', 'measurement@example.invalid'], { cwd: localGit })
  await run('git', ['add', 'segments'], { cwd: localGit }); await run('git', ['commit', '-qm', 'Local measurement artifacts'], { cwd: localGit })
  const beforePack = await run('git', ['count-objects', '-vH'], { cwd: localGit }); await run('git', ['repack', '-adq'], { cwd: localGit }); const afterPack = await run('git', ['count-objects', '-vH'], { cwd: localGit })
  const packFiles = await readdir(join(localGit, '.git', 'objects', 'pack')); let packBytes = 0
  for (const file of packFiles.filter((name) => name.endsWith('.pack'))) packBytes += (await stat(join(localGit, '.git', 'objects', 'pack', file))).size
  const objectList = await run('git', ['rev-list', '--objects', '--all'], { cwd: localGit })
  let largestBlob = 0
  for (const line of objectList.stdout.trim().split('\n')) {
    const oid = line.split(' ')[0]
    if (oid && (await run('git', ['cat-file', '-t', oid], { cwd: localGit })).stdout.trim() === 'blob') {
      largestBlob = Math.max(largestBlob, Number((await run('git', ['cat-file', '-s', oid], { cwd: localGit })).stdout.trim()))
    }
  }
  const localGitMeasurement = { beforePack: beforePack.stdout, afterPack: afterPack.stdout, packBytes, largestBlob, productionMutation: false }
  const githubPaths = ['rulesets', 'branches/main/protection', 'actions/permissions', 'actions/permissions/workflow']
  activePhase = 'github-protection-inventory'
  const githubProtection = []
  for (const path of githubPaths) {
    const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_READ_TOKEN ?? ''}`, 'User-Agent': 'xrpl-lending-read-only-measurement' },
    })
    const body = await response.text()
    githubProtection.push({ path, status: response.status, body: response.ok ? JSON.parse(body) : { unavailable: true } })
  }
  const summary = { schemaVersion: 1, kind: 'read-only-history-reconstruction-measurement', status: 'passed', failures: [], segments: measurements, exactIndexMeasurement, localGitMeasurement, githubProtection, productionMutation: false }
  assertReadOnlyMeasurementSummary(summary)
  await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await stat(join(output, 'summary.json'))
}

try {
  await main()
} catch (error) {
  await mkdir(output, { recursive: true })
  const failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const summary = { schemaVersion: 1, kind: 'read-only-history-reconstruction-measurement', status: 'failed', failures: [failure], segments: measurements, failedSegmentId: activeSegmentId, failedPhase: activePhase, productionMutation: false }
  assertReadOnlyMeasurementSummary(summary)
  await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  throw error
}
