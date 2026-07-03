import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { runLocalArtifactMeasurement } from '../src/node/current-state/artifact-measurement'

interface Arguments {
  root: string
  endpoint?: string
  timeoutMs?: number
  maxPagesPerRun?: number
  objectLimitPerPage?: number
  pageBudget?: number
  ledgerIndex?: number
  ledgerHash?: string
  epochId?: string
  snapshotId?: string
  outputPath?: string
}

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function integerArgument(args: string[], name: string): number | undefined {
  const value = argumentValue(args, name)
  if (value == null) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function parseArguments(args: string[]): Arguments {
  if (!args.includes('--local')) {
    throw new Error('Artifact measurement requires the explicit --local flag')
  }
  return {
    root: resolve(argumentValue(args, '--root') ?? '.local/current-state-measurement'),
    endpoint: argumentValue(args, '--endpoint') ?? undefined,
    timeoutMs: integerArgument(args, '--timeout-ms'),
    maxPagesPerRun: integerArgument(args, '--max-pages-per-run'),
    objectLimitPerPage: integerArgument(args, '--object-limit-per-page'),
    pageBudget: integerArgument(args, '--page-budget'),
    ledgerIndex: integerArgument(args, '--ledger-index'),
    ledgerHash: argumentValue(args, '--ledger-hash') ?? undefined,
    epochId: argumentValue(args, '--epoch-id') ?? undefined,
    snapshotId: argumentValue(args, '--snapshot-id') ?? undefined,
    outputPath: argumentValue(args, '--output')
      ? resolve(argumentValue(args, '--output')!)
      : undefined,
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const evidence = await runLocalArtifactMeasurement(args)
  const json = `${JSON.stringify(evidence, null, 2)}\n`
  if (args.outputPath) {
    await mkdir(dirname(args.outputPath), { recursive: true })
    await writeFile(args.outputPath, json, 'utf8')
  }
  process.stdout.write(json)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
