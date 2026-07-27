import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { canonicalJson } from '../../src/shared/current-state/canonical-json'
import {
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  reconstructionSegmentRange,
} from '../../src/shared/history-reconstruction/identity'
import { discoverResume } from '../../src/shared/history-reconstruction/resume'
import {
  assertAttempt,
  assertRawCheckpoint,
  type RawCheckpoint,
  type ReconstructionAttempt,
} from '../../src/shared/history-reconstruction/schema'
import {
  buildRawCheckpoint,
  checkpointFileName,
  committedCheckpointFiles,
  rawCheckpointDigest,
  type ReconstructionPredecessor,
} from '../../src/shared/history-reconstruction/runner'
import {
  checkpointPath,
  exists,
  segmentDirectory,
  segmentIdentity,
  type ReconstructionRuntimeOptions,
  verifySegmentDirectory,
  writeAtomic,
  writeExclusiveCanonical,
} from './common'

const run = promisify(execFile)

export async function readCheckpoints(outputDir: string): Promise<RawCheckpoint[]> {
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

async function attemptNumber(outputDir: string, id: number): Promise<number> {
  const path = join(outputDir, 'attempts', `${String(id).padStart(4, '0')}.json`)
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { attempt?: unknown }
    return Number.isSafeInteger(value.attempt) ? Number(value.attempt) + 1 : 1
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 1
    throw error
  }
}

async function writeAttempt(outputDir: string, attempt: ReconstructionAttempt): Promise<void> {
  assertAttempt(attempt)
  await writeAtomic(
    join(outputDir, 'attempts', `${String(attempt.segmentId).padStart(4, '0')}.json`),
    `${canonicalJson(attempt)}\n`,
  )
}

async function persistCheckpoint(outputDir: string, checkpoint: RawCheckpoint): Promise<void> {
  assertRawCheckpoint(checkpoint)
  await writeExclusiveCanonical(checkpointPath(outputDir, checkpoint.segmentId), checkpoint)
}

export async function completeSegment(options: {
  runtime: ReconstructionRuntimeOptions
  id: number
  checkpoints: RawCheckpoint[]
}): Promise<RawCheckpoint> {
  if (options.checkpoints.length !== options.id) throw new Error('Reconstruction prefix length does not match requested segment')
  const predecessorCheckpoint = options.checkpoints.at(-1) ?? null
  const predecessor: ReconstructionPredecessor | null = predecessorCheckpoint
    ? { checkpoint: predecessorCheckpoint, digest: await rawCheckpointDigest(predecessorCheckpoint) }
    : null
  const number = await attemptNumber(options.runtime.outputDir, options.id)
  const baseAttempt = {
    schemaVersion: 1 as const,
    kind: 'immutable-history-attempt' as const,
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    segmentId: options.id,
    attempt: number,
    lastSuccessfulLedgerIndex: predecessorCheckpoint?.endLedgerIndex ?? null,
    lastSuccessfulLedgerHash: predecessorCheckpoint?.terminalHash ?? null,
    lastPersistedCheckpointDigest: predecessor?.digest ?? null,
    productionMutation: false as const,
  }
  await writeAttempt(options.runtime.outputDir, { ...baseAttempt, state: 'started' })

  try {
    const destination = segmentDirectory(options.runtime.outputDir, options.id)
    if (!(await exists(destination))) {
      const range = reconstructionSegmentRange(options.id)
      const temporary = join(
        options.runtime.outputDir,
        'work',
        `segment-${String(options.id).padStart(4, '0')}-${process.pid}-${Date.now()}`,
      )
      await rm(temporary, { recursive: true, force: true })
      await mkdir(temporary, { recursive: true })
      const childArgs = [
        options.runtime.segmentRunner,
        '--local',
        '--endpoint', options.runtime.endpoint,
        '--read-window-size', String(options.runtime.readWindowSize),
        '--start-ledger', String(range.startLedgerIndex),
        '--end-ledger', String(range.endLedgerIndex),
        '--epoch-id', HISTORY_RECONSTRUCTION_EPOCH_ID,
        '--segment-id', segmentIdentity(options.id),
        '--output-dir', temporary,
        '--source-revision', options.runtime.sourceRevision,
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
      sourceImplementationSha: options.runtime.sourceRevision,
      predecessor,
    })
    await persistCheckpoint(options.runtime.outputDir, checkpoint)
    await writeAttempt(options.runtime.outputDir, {
      ...baseAttempt,
      state: 'completed',
      lastSuccessfulLedgerIndex: checkpoint.endLedgerIndex,
      lastSuccessfulLedgerHash: checkpoint.terminalHash,
      lastPersistedCheckpointDigest: await rawCheckpointDigest(checkpoint),
    })
    return checkpoint
  } catch (error) {
    await writeAttempt(options.runtime.outputDir, { ...baseAttempt, state: 'failed' })
    throw error
  }
}

export function nextSegmentId(checkpoints: readonly RawCheckpoint[]): number | null {
  return checkpoints.length === HISTORY_RECONSTRUCTION_SEGMENT_COUNT ? null : checkpoints.length
}
