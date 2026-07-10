import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import type { CatchUpBaseIdentity } from '../src/shared/catch-up-base-identity'
import {
  planReplacementBaseRebase,
  type ReplacementBaseRebaseEvidence,
} from '../src/worker/operator/replacement-base-rebase-plan'

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

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T
}

function assertTarget(target: CatchUpBaseIdentity): void {
  if (!target.epochId || !target.snapshotId) throw new Error('Replacement-base preflight target identity is incomplete')
  if (!Number.isSafeInteger(target.ledgerIndex) || target.ledgerIndex < 1) {
    throw new Error('Replacement-base preflight target ledger index is invalid')
  }
  if (!/^[A-F0-9]{64}$/.test(target.ledgerHash)) {
    throw new Error('Replacement-base preflight target ledger hash is invalid')
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('Replacement-base rebase planning requires --local')

  const target = await readJson<CatchUpBaseIdentity>(requiredArgument(args, '--target'))
  const evidence = await readJson<ReplacementBaseRebaseEvidence>(requiredArgument(args, '--evidence'))
  assertTarget(target)
  const plan = planReplacementBaseRebase({ target, evidence })

  process.stdout.write(`${canonicalJson({
    schemaVersion: 1,
    target,
    plan,
  })}\n`)
}

await main()
