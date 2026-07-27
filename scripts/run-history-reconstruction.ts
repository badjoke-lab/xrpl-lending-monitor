import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import {
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  HISTORY_RECONSTRUCTION_TARGET_HASH,
  HISTORY_RECONSTRUCTION_TARGET_LEDGER,
} from '../src/shared/history-reconstruction/identity'
import { discoverResume } from '../src/shared/history-reconstruction/resume'
import type { RawCheckpoint } from '../src/shared/history-reconstruction/schema'
import { buildCandidateAssets } from './history-reconstruction/candidate'
import {
  exists,
  type ReconstructionRuntimeOptions,
  writeAtomic,
  writeExclusiveCanonical,
} from './history-reconstruction/common'
import {
  completeSegment,
  nextSegmentId,
  readCheckpoints,
} from './history-reconstruction/raw-runner'

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

function parseArguments(args: readonly string[]): ReconstructionRuntimeOptions {
  if (!args.includes('--local')) throw new Error('Immutable history reconstruction requires --local')
  const sourceRevision = value(args, '--source-revision') ?? process.env.GITHUB_SHA ?? ''
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) {
    throw new Error('--source-revision must be a 40-character lowercase Git commit SHA')
  }
  const readWindowSize = positiveInteger(args, '--read-window-size', 16)
  if (readWindowSize > 16) throw new Error('--read-window-size may be at most 16')
  const maxSegments = positiveInteger(args, '--max-segments', HISTORY_RECONSTRUCTION_SEGMENT_COUNT)
  if (maxSegments > HISTORY_RECONSTRUCTION_SEGMENT_COUNT) {
    throw new Error('--max-segments exceeds the fixed reconstruction plan')
  }
  const outputDir = resolve(value(args, '--output-dir') ?? '.local/history-reconstruction')
  if (outputDir === resolve('.') || outputDir.split('/').includes('.git')) throw new Error('--output-dir is unsafe')
  return {
    endpoint: value(args, '--endpoint') ?? 'https://clio.devnet.rippletest.net:51234/',
    outputDir,
    sourceRevision,
    segmentRunner: resolve(value(args, '--segment-runner') ?? '.history-segment-build/run-history-segment.mjs'),
    readWindowSize,
    maxSegments,
  }
}

async function freezePlan(runtime: ReconstructionRuntimeOptions): Promise<void> {
  const path = join(runtime.outputDir, 'plan.json')
  const plan = {
    schemaVersion: 1,
    kind: 'immutable-history-reconstruction-plan',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    sourceRevision: runtime.sourceRevision,
    endpoint: runtime.endpoint,
    readWindowSize: runtime.readWindowSize,
    productionMutation: false,
  }
  if (await exists(path)) {
    const existing = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (canonicalJson(existing) !== canonicalJson(plan)) {
      throw new Error('Reconstruction resume plan identity mismatch')
    }
    return
  }
  await writeExclusiveCanonical(path, plan)
}

async function writeSummary(options: {
  outputDir: string
  checkpoints: readonly RawCheckpoint[]
  status: 'incomplete' | 'candidate-assets-ready'
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

async function main(runtime: ReconstructionRuntimeOptions): Promise<void> {
  await mkdir(runtime.outputDir, { recursive: true })
  await freezePlan(runtime)
  let checkpoints = await readCheckpoints(runtime.outputDir)
  let next = nextSegmentId(checkpoints)
  let processed = 0
  while (next !== null && processed < runtime.maxSegments) {
    checkpoints = [...checkpoints, await completeSegment({ runtime, id: next, checkpoints })]
    next = nextSegmentId(checkpoints)
    processed += 1
  }
  if (next !== null) {
    await writeSummary({ outputDir: runtime.outputDir, checkpoints, status: 'incomplete' })
    process.stdout.write(`${canonicalJson({ status: 'incomplete', completedSegments: checkpoints.length, nextSegmentId: next })}\n`)
    return
  }
  await buildCandidateAssets({
    outputDir: runtime.outputDir,
    checkpoints,
    sourceRevision: runtime.sourceRevision,
  })
  await writeSummary({ outputDir: runtime.outputDir, checkpoints, status: 'candidate-assets-ready' })
  process.stdout.write(`${canonicalJson({
    status: 'candidate-assets-ready',
    completedSegments: checkpoints.length,
    productionMutation: false,
  })}\n`)
}

const runtime = parseArguments(process.argv.slice(2))
try {
  await main(runtime)
} catch (error) {
  const failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const checkpoints = await readCheckpoints(runtime.outputDir).catch(() => [])
  await writeSummary({
    outputDir: runtime.outputDir,
    checkpoints,
    status: 'incomplete',
    failure,
  }).catch(() => undefined)
  throw error
}
