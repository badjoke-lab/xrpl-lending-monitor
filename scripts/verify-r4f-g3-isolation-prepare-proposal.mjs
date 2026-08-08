import { readFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const commentsPath = argument('--comments')
const runPath = argument('--run')
const prepareRunText = argument('--prepare-run')
const commit = argument('--commit')
const projectDigest = argument('--project-digest')
const jobIdText = argument('--job-id')
const commandDigest = argument('--command-digest')
const authorizationCreatedAt = argument('--authorization-created-at')

if (
  !commentsPath ||
  !runPath ||
  !/^[1-9][0-9]*$/u.test(prepareRunText ?? '') ||
  !/^[a-f0-9]{40}$/u.test(commit ?? '') ||
  !/^[a-f0-9]{64}$/u.test(projectDigest ?? '') ||
  !/^[1-9][0-9]*$/u.test(jobIdText ?? '') ||
  !/^[a-f0-9]{64}$/u.test(commandDigest ?? '') ||
  !authorizationCreatedAt
) {
  throw new Error(
    'usage: verify-r4f-g3-isolation-prepare-proposal --comments <json> --run <json> --prepare-run <id> --commit <sha> --project-digest <sha256> --job-id <id> --command-digest <sha256> --authorization-created-at <iso>',
  )
}

const comments = JSON.parse(await readFile(commentsPath, 'utf8'))
const run = JSON.parse(await readFile(runPath, 'utf8'))
if (!Array.isArray(comments)) throw new Error('issue comments payload must be an array')

const prepareRun = Number(prepareRunText)
const jobId = Number(jobIdText)
if (!Number.isSafeInteger(prepareRun) || !Number.isSafeInteger(jobId)) {
  throw new Error('prepare run or cron job id exceeds safe integer range')
}

if (run.name !== 'R4F G3 Isolated Window') throw new Error('isolation prepare workflow mismatch')
if (run.event !== 'issue_comment') throw new Error('isolation prepare event mismatch')
if (run.conclusion !== 'success') throw new Error('isolation prepare run is not successful')
if (Number(run.id) !== prepareRun) throw new Error('isolation prepare run id mismatch')
if (run.head_sha !== commit) throw new Error('isolation prepare source commit mismatch')

const runCreatedAt = Date.parse(String(run.created_at ?? ''))
const authorizationAt = Date.parse(authorizationCreatedAt)
if (!Number.isFinite(runCreatedAt) || !Number.isFinite(authorizationAt)) {
  throw new Error('isolation prepare or authorization timestamp is invalid')
}
if (runCreatedAt > authorizationAt) throw new Error('pause authorization predates isolation prepare run')

const exactCommand = `/r4f-g3-isolation-pause commit=${commit} project=${projectDigest} job=${jobId} command=${commandDigest} prepare_run=${prepareRun}`
const requiredFragments = [
  '## R4F G3 isolated-window pause authorization proposal',
  `Preparation run: \`${prepareRun}\``,
  `Source commit: \`${commit}\``,
  `Project identity digest: \`${projectDigest}\``,
  'Collector cron job: `xrpl-lending-monitor-minute`',
  `Cron job id: \`${jobId}\``,
  'Schedule: `* * * * *`',
  `Scheduler command digest: \`${commandDigest}\``,
  'A database-local watchdog is installed before the collector is paused.',
  'The pause is bounded to at most 15 minutes.',
  `\`${exactCommand}\``,
]

const matches = comments.filter((comment) => {
  if (comment?.user?.login !== 'github-actions[bot]') return false
  if (typeof comment?.body !== 'string') return false
  return requiredFragments.every((fragment) => comment.body.includes(fragment))
})
if (matches.length !== 1) {
  throw new Error(`expected exactly one matching isolation prepare proposal, found ${matches.length}`)
}

const proposalCreatedAt = Date.parse(String(matches[0].created_at ?? ''))
if (!Number.isFinite(proposalCreatedAt)) throw new Error('isolation proposal timestamp is invalid')
if (proposalCreatedAt < runCreatedAt || proposalCreatedAt > authorizationAt) {
  throw new Error('isolation proposal is outside prepare-to-authorization ordering')
}
const occurrences = matches[0].body.split(exactCommand).length - 1
if (occurrences !== 1) throw new Error('exact pause authorization command must appear once')

process.stdout.write(`${JSON.stringify({
  prepareRun,
  prepareProposalCommentId: Number(matches[0].id),
  sourceCommit: commit,
  projectIdentityDigest: projectDigest,
  cronJobId: jobId,
  commandDigest,
  exactCommandVerified: true,
  watchdogBeforePauseVerified: true,
  fifteenMinuteMaximumVerified: true,
})}\n`)
