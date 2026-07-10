import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import { buildHistoryExtensionPlan } from '../src/shared/history-segments/extension-plan'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from '../src/shared/history-segments/publication'

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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('History extension planning requires --local')

  const publicationPath = resolve(requiredArgument(args, '--publication'))
  const outputPath = resolve(requiredArgument(args, '--output'))
  const publication = JSON.parse(await readFile(publicationPath, 'utf8')) as HistorySegmentChainPublication
  await assertHistorySegmentPublicationDigest(publication)

  const plan = buildHistoryExtensionPlan({
    publication,
    targetLedgerIndex: positiveInteger(args, '--target-ledger'),
    targetLedgerHash: requiredArgument(args, '--target-ledger-hash'),
    segmentLedgerLimit: positiveInteger(args, '--segment-ledgers'),
    checkpointEverySegments: positiveInteger(args, '--checkpoint-every-segments'),
  })
  const text = `${canonicalJson(plan)}\n`
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, text, 'utf8')
  process.stdout.write(text)
}

await main()
