import { readFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const commentsPath = argument('--comments')
const runPath = argument('--run')
const prepareRun = argument('--prepare-run')
const commit = argument('--commit')
const ledgerText = argument('--ledger')
const projectDigest = argument('--project-digest')
const authorizationCreatedAt = argument('--authorization-created-at')

if (
  !commentsPath ||
  !runPath ||
  !/^[1-9][0-9]*$/u.test(prepareRun ?? '') ||
  !/^[a-f0-9]{40}$/u.test(commit ?? '') ||
  !/^[1-9][0-9]*$/u.test(ledgerText ?? '') ||
  !/^[a-f0-9]{64}$/u.test(projectDigest ?? '') ||
  !authorizationCreatedAt
) {
  throw new Error(
    'usage: verify-r4f-g3-prepare-proposal --comments <json> --run <json> --prepare-run <id> --commit <sha> --ledger <index> --project-digest <sha256> --authorization-created-at <iso>',
  )
}

const comments = JSON.parse(await readFile(commentsPath, 'utf8'))
const run = JSON.parse(await readFile(runPath, 'utf8'))
if (!Array.isArray(comments)) throw new Error('issue comments payload must be an array')

const runId = Number(prepareRun)
const ledger = Number(ledgerText)
if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(ledger)) {
  throw new Error('prepare run or ledger exceeds safe integer range')
}

if (run.name !== 'R4F G3 One-Shot Probe') throw new Error('prepare run workflow mismatch')
if (run.event !== 'issue_comment') throw new Error('prepare run event mismatch')
if (run.conclusion !== 'success') throw new Error('prepare run is not successful')
if (Number(run.id) !== runId) throw new Error('prepare run id mismatch')
if (run.head_sha !== commit) throw new Error('prepare run commit mismatch')

const runCreatedAt = Date.parse(String(run.created_at ?? ''))
const authorizationAt = Date.parse(authorizationCreatedAt)
if (!Number.isFinite(runCreatedAt) || !Number.isFinite(authorizationAt)) {
  throw new Error('authorization or prepare timestamp is invalid')
}
if (runCreatedAt > authorizationAt) {
  throw new Error('authorization predates prepare run')
}

const exactCommand = `/r4f-g3-authorize commit=${commit} ledger=${ledger} project=${projectDigest} prepare_run=${runId}`
const requiredFragments = [
  '## R4F G3 one-shot authorization proposal',
  `Preparation run: \`${runId}\``,
  `Source commit: \`${commit}\``,
  `Project identity digest: \`${projectDigest}\``,
  `Exact Devnet ledger: \`${ledger}\``,
  `\`${exactCommand}\``,
  'Before authorizing, retain the project-filtered Supabase Usage → **Total Egress** reading for the same billing period.',
]

const matches = comments.filter((comment) => {
  if (comment?.user?.login !== 'github-actions[bot]') return false
  if (typeof comment?.body !== 'string') return false
  return requiredFragments.every((fragment) => comment.body.includes(fragment))
})

if (matches.length !== 1) {
  throw new Error(`expected exactly one matching prepare proposal comment, found ${matches.length}`)
}

const proposalCreatedAt = Date.parse(String(matches[0].created_at ?? ''))
if (!Number.isFinite(proposalCreatedAt)) throw new Error('prepare proposal timestamp is invalid')
if (proposalCreatedAt < runCreatedAt || proposalCreatedAt > authorizationAt) {
  throw new Error('prepare proposal is outside prepare-to-authorization ordering')
}

const occurrences = matches[0].body.split(exactCommand).length - 1
if (occurrences !== 1) throw new Error('exact authorization command must appear once in prepare proposal')

process.stdout.write(
  `${JSON.stringify({
    prepareRun: runId,
    prepareProposalCommentId: Number(matches[0].id),
    sourceCommit: commit,
    ledger,
    projectIdentityDigest: projectDigest,
    exactCommandVerified: true,
    beforeCaptureInstructionVerified: true,
  })}\n`,
)
