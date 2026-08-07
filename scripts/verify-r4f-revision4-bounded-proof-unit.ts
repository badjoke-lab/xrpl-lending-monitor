import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  type SupabaseRevision4G9Input,
  verifySupabaseRevision4BoundedProofUnit,
} from '../src/shared/supabase-revision4-bounded-proof-unit'

interface Arguments { inputPath: string | null; outputPath: string | null; requireProofReady: boolean; help: boolean }

function usage(): string {
  return [
    'Usage:',
    '  node r4f-revision4-bounded-proof-unit-verifier.mjs --input <path> [--output <path>] [--require-proof-ready]',
    '',
    'Offline verifier only. It does not authorize or execute a proof unit.',
  ].join('\n')
}

function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = { inputPath: null, outputPath: null, requireProofReady: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') { parsed.help = true; continue }
    if (argument === '--require-proof-ready') { parsed.requireProofReady = true; continue }
    if (argument === '--input') { parsed.inputPath = argv[index + 1] ?? null; index += 1; continue }
    if (argument === '--output') { parsed.outputPath = argv[index + 1] ?? null; index += 1; continue }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return parsed
}

function main(): void {
  const args = parseArguments(process.argv.slice(2))
  if (args.help) { console.log(usage()); return }
  if (!args.inputPath) throw new Error(`--input is required\n\n${usage()}`)
  const input = JSON.parse(readFileSync(resolve(args.inputPath), 'utf8')) as SupabaseRevision4G9Input
  const result = verifySupabaseRevision4BoundedProofUnit(input)
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (args.outputPath) writeFileSync(resolve(args.outputPath), serialized, 'utf8')
  console.log(JSON.stringify({ evidenceId: result.evidenceId, evidenceClass: result.evidenceClass, proofReady: result.proofReady, blockingReasons: result.blockingReasons, machineSummary: result.machineSummary, outputPath: args.outputPath ? resolve(args.outputPath) : null }))
  if (args.requireProofReady && !result.proofReady) process.exitCode = 2
}

try { main() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
