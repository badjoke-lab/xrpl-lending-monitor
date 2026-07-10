import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import { assertHistoryExtensionArtifacts } from '../src/shared/history-segments/extension-artifacts'
import type { HistoryExtensionPlan } from '../src/shared/history-segments/extension-plan'
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

function requiredArgument(args: readonly string[], name: string): string {
  const values = argumentValues(args, name)
  if (values.length !== 1) throw new Error(`${name} must be supplied exactly once`)
  return values[0]!
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('History extension artifact verification requires --local')

  const plan = JSON.parse(
    await readFile(resolve(requiredArgument(args, '--plan')), 'utf8'),
  ) as HistoryExtensionPlan
  const manifestPaths = argumentValues(args, '--manifest')
  if (manifestPaths.length === 0) throw new Error('At least one --manifest is required')

  const manifests: HistorySegmentManifest[] = []
  for (const path of manifestPaths) {
    manifests.push(JSON.parse(await readFile(resolve(path), 'utf8')) as HistorySegmentManifest)
  }

  const summary = assertHistoryExtensionArtifacts({ plan, manifests })
  process.stdout.write(`${canonicalJson(summary)}\n`)
}

await main()
