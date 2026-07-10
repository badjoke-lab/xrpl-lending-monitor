import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import type { HistoryExtensionPlan } from '../src/shared/history-segments/extension-plan'
import { buildHistoryExtensionShardPlan } from '../src/shared/history-segments/extension-shards'

function value(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const result = index < 0 ? null : args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} is required`)
  return result
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('History extension shard planning requires --local')
  const plan = JSON.parse(await readFile(resolve(value(args, '--plan')), 'utf8')) as HistoryExtensionPlan
  const segmentsPerShard = Number(value(args, '--segments-per-shard'))
  const shardPlan = buildHistoryExtensionShardPlan({ extensionPlan: plan, segmentsPerShard })
  const output = resolve(value(args, '--output'))
  await mkdir(dirname(output), { recursive: true })
  const text = `${canonicalJson(shardPlan)}\n`
  await writeFile(output, text, 'utf8')
  process.stdout.write(text)
}

await main()
