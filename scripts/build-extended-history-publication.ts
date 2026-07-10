import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { canonicalJson, sha256Hex } from '../src/shared/current-state/canonical-json'
import { buildExtendedHistoryPublication } from '../src/shared/history-segments/extended-publication'
import type { HistoryExtensionPlan } from '../src/shared/history-segments/extension-plan'
import type { HistorySegmentManifest } from '../src/shared/history-segments/manifest'
import type { HistorySegmentChainPublication } from '../src/shared/history-segments/publication'

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

function safeId(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('Extended history publication generation requires --local')

  const sourcePublication = JSON.parse(
    await readFile(resolve(requiredArgument(args, '--source-publication')), 'utf8'),
  ) as HistorySegmentChainPublication
  const plan = JSON.parse(
    await readFile(resolve(requiredArgument(args, '--plan')), 'utf8'),
  ) as HistoryExtensionPlan
  const manifestPaths = argumentValues(args, '--manifest').map((path) => resolve(path))
  if (manifestPaths.length === 0) throw new Error('At least one --manifest is required')

  const extensionManifests = []
  for (const path of manifestPaths) {
    const bytes = new Uint8Array(await readFile(path))
    extensionManifests.push({
      manifest: JSON.parse(new TextDecoder().decode(bytes)) as HistorySegmentManifest,
      manifestSha256: await sha256Hex(bytes),
    })
  }

  const publication = await buildExtendedHistoryPublication({
    sourcePublication,
    plan,
    extensionManifests,
    chainId: safeId(requiredArgument(args, '--chain-id'), 'chainId'),
    sourceRevision: safeId(requiredArgument(args, '--source-revision'), 'sourceRevision'),
  })

  const outputPath = resolve(requiredArgument(args, '--output'))
  await mkdir(dirname(outputPath), { recursive: true })
  const text = `${canonicalJson(publication)}\n`
  await writeFile(outputPath, text, 'utf8')
  process.stdout.write(text)
}

await main()
