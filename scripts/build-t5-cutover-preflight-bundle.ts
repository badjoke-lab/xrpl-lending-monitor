import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import type { HistorySegmentChainPublication } from '../src/shared/history-segments/publication'
import { buildT5CutoverPreflightBundle, type T5CandidateRehearsalSummary } from '../src/shared/t5-cutover-preflight'
import type { ReplacementBaseRebaseEvidence } from '../src/worker/operator/replacement-base-rebase-plan'

function value(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const result = index < 0 ? null : args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} is required`)
  return result
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('T5 cutover preflight bundle generation requires --local')
  const bundle = await buildT5CutoverPreflightBundle({
    candidate: await json<T5CandidateRehearsalSummary>(value(args, '--candidate-summary')),
    historyPublication: await json<HistorySegmentChainPublication>(value(args, '--history-publication')),
    productionEvidence: await json<ReplacementBaseRebaseEvidence>(value(args, '--production-evidence')),
    historyCommitSha: value(args, '--history-commit-sha'),
    currentStateCommitSha: value(args, '--current-state-commit-sha'),
  })
  process.stdout.write(`${canonicalJson(bundle)}\n`)
}

await main()
