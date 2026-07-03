import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { getPlatformProxy } from 'wrangler'

import {
  executeD1CurrentStateOperator,
  type D1OperatorAction,
} from '../src/worker/operator/d1-current-state-operator'

interface Arguments {
  inputPath: string
  configPath: string
  persistPath: string
  outputPath: string | null
}

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function parseArguments(args: string[]): Arguments {
  if (!args.includes('--local')) {
    throw new Error('The D1 operator requires the explicit --local flag')
  }
  const inputPath = argumentValue(args, '--input')
  if (!inputPath) throw new Error('--input is required')
  return {
    inputPath: resolve(inputPath),
    configPath: resolve(argumentValue(args, '--config') ?? 'wrangler.d1-test.jsonc'),
    persistPath: resolve(argumentValue(args, '--persist') ?? '.wrangler/d1-operator'),
    outputPath: argumentValue(args, '--output')
      ? resolve(argumentValue(args, '--output')!)
      : null,
  }
}

async function readAction(path: string): Promise<D1OperatorAction> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || !('action' in value)) {
    throw new Error('Operator input must be a JSON object with an action')
  }
  return value as D1OperatorAction
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  await mkdir(args.persistPath, { recursive: true })
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: args.configPath,
    persist: { path: args.persistPath },
    remoteBindings: false,
  })

  try {
    const evidence = await executeD1CurrentStateOperator({
      db: platform.env.DB,
      input: await readAction(args.inputPath),
      heapUsedBytes: () => process.memoryUsage().heapUsed,
    })
    const json = `${JSON.stringify(evidence, null, 2)}\n`
    if (args.outputPath) {
      await mkdir(dirname(args.outputPath), { recursive: true })
      await writeFile(args.outputPath, json, 'utf8')
    }
    process.stdout.write(json)
  } finally {
    await platform.dispose()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
