import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function value(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return null
  const result = args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value`)
  return result
}

function required(args, name) {
  const result = value(args, name)
  if (result === null) throw new Error(`${name} is required`)
  return result
}

function positiveInteger(args, name, fallback) {
  const raw = value(args, name)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function exists(path) {
  try {
    await readFile(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function validatePlan(plan) {
  if (plan?.schemaVersion !== 1 || plan?.network !== 'devnet') throw new Error('History extension plan schema is invalid')
  if (!Array.isArray(plan?.extension?.segments) || plan.extension.segments.length !== plan.extension.segmentCount) {
    throw new Error('History extension segment count is invalid')
  }
  if (plan.extension.startLedgerIndex !== plan.source.endLedgerIndex + 1) throw new Error('History extension start is not contiguous')
  if (plan.extension.endLedgerIndex !== plan.target.ledgerIndex) throw new Error('History extension target mismatch')
  if (plan.extension.anchorPreviousSegmentId !== plan.source.lastSegmentId) throw new Error('History extension anchor ID mismatch')
  if (plan.extension.anchorPreviousSegmentEndHash !== plan.source.endLedgerHash) throw new Error('History extension anchor hash mismatch')
}

function validateCheckpoint(plan, checkpoint) {
  if (checkpoint.epochId !== plan.epochId) throw new Error('Checkpoint epoch mismatch')
  if (checkpoint.rangeStartLedgerIndex !== plan.extension.startLedgerIndex) throw new Error('Checkpoint range start mismatch')
  if (checkpoint.rangeEndLedgerIndex !== plan.extension.endLedgerIndex) throw new Error('Checkpoint range end mismatch')
  if (checkpoint.anchorPreviousSegmentId !== plan.extension.anchorPreviousSegmentId) throw new Error('Checkpoint anchor ID mismatch')
  if (checkpoint.anchorPreviousSegmentEndHash !== plan.extension.anchorPreviousSegmentEndHash) throw new Error('Checkpoint anchor hash mismatch')
  if (!Array.isArray(checkpoint.completedSegments)) throw new Error('Checkpoint completedSegments is invalid')
  if (checkpoint.completedSegments.length > plan.extension.segments.length) throw new Error('Checkpoint exceeds extension plan')
  const next = plan.extension.segments[checkpoint.completedSegments.length]
  const expectedNext = next ? next.startLedgerIndex : plan.target.ledgerIndex + 1
  if (checkpoint.nextLedgerIndex !== expectedNext) throw new Error('Checkpoint next ledger does not match extension plan')
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('Resumable history extension requires --local')
  const planPath = resolve(required(args, '--plan'))
  const outputDir = resolve(required(args, '--output-dir'))
  const maxSegments = positiveInteger(args, '--max-segments', 1)
  const endpoint = value(args, '--endpoint') ?? 'https://devnet.honeycluster.io/'
  const sourceRevision = value(args, '--source-revision') ?? process.env.GITHUB_SHA ?? ''
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('--source-revision must be a 40-character lowercase Git SHA')

  const segmentRunner = resolve(value(args, '--segment-runner') ?? '.history-segment-build/run-history-segment.mjs')
  const checkpointRunner = resolve(value(args, '--checkpoint-runner') ?? '.history-segment-checkpoint-build/update-history-segment-checkpoint.mjs')
  const checkpointPath = join(outputDir, 'checkpoint.json')
  const plan = await readJson(planPath)
  validatePlan(plan)
  await mkdir(outputDir, { recursive: true })

  let checkpoint = (await exists(checkpointPath)) ? await readJson(checkpointPath) : null
  if (checkpoint) validateCheckpoint(plan, checkpoint)
  const startOrdinal = checkpoint?.completedSegments?.length ?? 0
  const stopOrdinal = Math.min(plan.extension.segmentCount, startOrdinal + maxSegments)
  let previousSegmentId = checkpoint?.previousSegmentId ?? plan.extension.anchorPreviousSegmentId
  let previousSegmentEndHash = checkpoint?.previousSegmentEndHash ?? plan.extension.anchorPreviousSegmentEndHash

  for (let ordinal = startOrdinal; ordinal < stopOrdinal; ordinal += 1) {
    const segment = plan.extension.segments[ordinal]
    if (!segment || segment.ordinal !== ordinal) throw new Error(`Plan segment ordinal mismatch at ${ordinal}`)
    const destination = join(outputDir, 'history', plan.epochId, segment.segmentId)
    const manifestPath = join(destination, 'manifest.json')

    if (!(await exists(manifestPath))) {
      await mkdir(destination, { recursive: true })
      const childArgs = [
        segmentRunner,
        '--local',
        '--endpoint', endpoint,
        '--timeout-ms', '8000',
        '--read-window-size', '16',
        '--start-ledger', String(segment.startLedgerIndex),
        '--end-ledger', String(segment.endLedgerIndex),
        '--epoch-id', plan.epochId,
        '--segment-id', segment.segmentId,
        '--previous-segment-id', previousSegmentId,
        '--previous-segment-end-hash', previousSegmentEndHash,
        '--source-revision', sourceRevision,
        '--output-dir', destination,
      ]
      await run(process.execPath, childArgs, { maxBuffer: 32 * 1024 * 1024 })
    }

    await run(process.execPath, [
      checkpointRunner,
      '--local',
      '--checkpoint', checkpointPath,
      '--manifest', manifestPath,
      '--epoch-id', plan.epochId,
      '--range-start-ledger', String(plan.extension.startLedgerIndex),
      '--range-end-ledger', String(plan.extension.endLedgerIndex),
      '--previous-segment-id', plan.extension.anchorPreviousSegmentId,
      '--previous-segment-end-hash', plan.extension.anchorPreviousSegmentEndHash,
    ], { maxBuffer: 8 * 1024 * 1024 })

    checkpoint = await readJson(checkpointPath)
    validateCheckpoint(plan, checkpoint)
    previousSegmentId = checkpoint.previousSegmentId
    previousSegmentEndHash = checkpoint.previousSegmentEndHash
  }

  const completedSegments = checkpoint?.completedSegments?.length ?? 0
  const summary = {
    schemaVersion: 1,
    kind: 'resumable-history-extension',
    sourceLedgerIndex: plan.source.endLedgerIndex,
    targetLedgerIndex: plan.target.ledgerIndex,
    totalSegments: plan.extension.segmentCount,
    completedSegments,
    remainingSegments: plan.extension.segmentCount - completedSegments,
    nextLedgerIndex: checkpoint?.nextLedgerIndex ?? plan.extension.startLedgerIndex,
    complete: completedSegments === plan.extension.segmentCount,
    productionMutation: false,
  }
  await writeFile(join(outputDir, 'summary.json'), `${JSON.stringify(summary)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

await main()
