import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import {
  assertHistorySegmentChain,
  type HistorySegmentChainExpectation,
} from '../src/shared/history-segments/chain'
import type { HistorySegmentManifest } from '../src/shared/history-segments/manifest'

function argumentValues(args: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    values.push(value)
  }
  return values
}

function argumentValue(args: readonly string[], name: string): string | null {
  const values = argumentValues(args, name)
  if (values.length > 1) throw new Error(`${name} may be supplied at most once`)
  return values[0] ?? null
}

function requiredArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(args: readonly string[], name: string, required = true): number | undefined {
  const raw = argumentValue(args, name)
  if (raw === null) {
    if (required) throw new Error(`${name} is required`)
    return undefined
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function hash(value: string, field: string): string {
  const normalized = value.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a 64-character hexadecimal hash`)
  }
  return normalized
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('History segment chain verification requires --local')

  const manifestPaths = argumentValues(args, '--manifest').map((path) => resolve(path))
  if (manifestPaths.length === 0) throw new Error('At least one --manifest is required')

  const previousSegmentId = argumentValue(args, '--previous-segment-id')
  const previousSegmentEndHashRaw = argumentValue(args, '--previous-segment-end-hash')
  if ((previousSegmentId === null) !== (previousSegmentEndHashRaw === null)) {
    throw new Error('Previous segment ID and terminal hash must be supplied together')
  }

  const endLedgerIndex = positiveInteger(args, '--end-ledger', false)
  const endLedgerHashRaw = argumentValue(args, '--end-ledger-hash')
  if ((endLedgerIndex === undefined) !== (endLedgerHashRaw === null)) {
    throw new Error('End ledger index and hash must be supplied together')
  }

  const manifests: HistorySegmentManifest[] = []
  for (const path of manifestPaths) {
    manifests.push(JSON.parse(await readFile(path, 'utf8')) as HistorySegmentManifest)
  }

  const expectation: HistorySegmentChainExpectation = {
    network: 'devnet',
    epochId: requiredArgument(args, '--epoch-id'),
    startLedgerIndex: positiveInteger(args, '--start-ledger')!,
    startParentHash: hash(requiredArgument(args, '--start-parent-hash'), 'startParentHash'),
    previousSegmentId,
    previousSegmentEndHash: previousSegmentEndHashRaw === null
      ? null
      : hash(previousSegmentEndHashRaw, 'previousSegmentEndHash'),
    ...(endLedgerIndex === undefined ? {} : { endLedgerIndex }),
    ...(endLedgerHashRaw === null ? {} : { endLedgerHash: hash(endLedgerHashRaw, 'endLedgerHash') }),
  }

  const summary = assertHistorySegmentChain(manifests, expectation)
  process.stdout.write(`${canonicalJson(summary)}\n`)
}

await main()
