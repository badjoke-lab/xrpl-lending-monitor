import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  advanceHistorySegmentCheckpoint,
  assertHistorySegmentCheckpoint,
  createHistorySegmentCheckpoint,
  type HistorySegmentCheckpoint,
} from '../src/shared/history-segments/checkpoint'
import { canonicalJson, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import {
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from '../src/shared/history-segments/manifest'

interface Arguments {
  checkpointPath: string
  manifestPath: string
  epochId: string
  rangeStartLedgerIndex: number
  rangeEndLedgerIndex: number
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
}

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function requiredArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(args: readonly string[], name: string): number {
  const value = Number(requiredArgument(args, name))
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function optionalHash(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error('--previous-segment-end-hash must be a 64-character hexadecimal hash')
  }
  return normalized
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('History segment checkpoint updates require --local')
  const previousSegmentId = argumentValue(args, '--previous-segment-id')
  const previousSegmentEndHash = optionalHash(argumentValue(args, '--previous-segment-end-hash'))
  if ((previousSegmentId === null) !== (previousSegmentEndHash === null)) {
    throw new Error('Previous segment ID and terminal hash must be supplied together')
  }
  return {
    checkpointPath: resolve(requiredArgument(args, '--checkpoint')),
    manifestPath: resolve(requiredArgument(args, '--manifest')),
    epochId: requiredArgument(args, '--epoch-id'),
    rangeStartLedgerIndex: positiveInteger(args, '--range-start-ledger'),
    rangeEndLedgerIndex: positiveInteger(args, '--range-end-ledger'),
    previousSegmentId,
    previousSegmentEndHash,
  }
}

async function readExistingCheckpoint(path: string): Promise<HistorySegmentCheckpoint | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as HistorySegmentCheckpoint
    assertHistorySegmentCheckpoint(value)
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertInvocationMatchesCheckpoint(
  checkpoint: HistorySegmentCheckpoint,
  options: Arguments,
): void {
  if (checkpoint.epochId !== options.epochId) throw new Error('Checkpoint epoch does not match invocation')
  if (checkpoint.rangeStartLedgerIndex !== options.rangeStartLedgerIndex) {
    throw new Error('Checkpoint range start does not match invocation')
  }
  if (checkpoint.rangeEndLedgerIndex !== options.rangeEndLedgerIndex) {
    throw new Error('Checkpoint range end does not match invocation')
  }
  if (checkpoint.anchorPreviousSegmentId !== options.previousSegmentId) {
    throw new Error('Checkpoint anchor previous segment ID does not match invocation')
  }
  if (checkpoint.anchorPreviousSegmentEndHash !== options.previousSegmentEndHash) {
    throw new Error('Checkpoint anchor previous segment hash does not match invocation')
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const manifestText = await readFile(options.manifestPath, 'utf8')
  const manifest = JSON.parse(manifestText) as HistorySegmentManifest
  assertHistorySegmentManifest(manifest)

  const existing = await readExistingCheckpoint(options.checkpointPath)
  const checkpoint = existing ?? createHistorySegmentCheckpoint({
    network: 'devnet',
    epochId: options.epochId,
    rangeStartLedgerIndex: options.rangeStartLedgerIndex,
    rangeEndLedgerIndex: options.rangeEndLedgerIndex,
    previousSegmentId: options.previousSegmentId,
    previousSegmentEndHash: options.previousSegmentEndHash,
  })
  assertInvocationMatchesCheckpoint(checkpoint, options)

  const next = advanceHistorySegmentCheckpoint({
    checkpoint,
    manifest,
    manifestSha256: await sha256Hex(utf8(manifestText)),
  })

  await mkdir(dirname(options.checkpointPath), { recursive: true })
  const tempPath = `${options.checkpointPath}.tmp-${process.pid}`
  await writeFile(tempPath, `${canonicalJson(next)}\n`, 'utf8')
  await rename(tempPath, options.checkpointPath)
  process.stdout.write(`${canonicalJson(next)}\n`)
}

await main()
