import { resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import { finalizeCandidateChannel } from './history-reconstruction/candidate'

function required(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const result = index < 0 ? null : args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} is required`)
  return result
}

const args = process.argv.slice(2)
if (!args.includes('--local')) throw new Error('Candidate finalization requires --local')
const outputDir = resolve(required(args, '--output-dir'))
const dataCommitSha = required(args, '--data-commit-sha')
await finalizeCandidateChannel({ outputDir, dataCommitSha })
process.stdout.write(`${canonicalJson({
  status: 'candidate-channel-ready',
  dataCommitSha,
  productionMutation: false,
})}\n`)
