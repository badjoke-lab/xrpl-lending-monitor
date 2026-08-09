import { readFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const commentsPath = argument('--comments')
const pauseRunPath = argument('--pause-run')
const oneShotRunPath = argument('--one-shot-run')
const pauseRunIdText = argument('--pause-run-id')
const beforeCommentIdText = argument('--before-comment-id')
const projectDigest = argument('--project-digest')
const jobIdText = argument('--job-id')
const commandDigest = argument('--command-digest')
const resumeCreatedAt = argument('--resume-created-at')

const POSITIVE_INTEGER = /^[1-9][0-9]*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u

if (
  !commentsPath ||
  !pauseRunPath ||
  !oneShotRunPath ||
  !POSITIVE_INTEGER.test(pauseRunIdText ?? '') ||
  !POSITIVE_INTEGER.test(beforeCommentIdText ?? '') ||
  !SHA256.test(projectDigest ?? '') ||
  !POSITIVE_INTEGER.test(jobIdText ?? '') ||
  !SHA256.test(commandDigest ?? '') ||
  !resumeCreatedAt ||
  !CANONICAL_UTC.test(resumeCreatedAt)
) {
  throw new Error(
    'usage: verify-r4f-g3-resume-sequence --comments <json> --pause-run <json> --one-shot-run <json> --pause-run-id <id> --before-comment-id <id> --project-digest <sha256> --job-id <id> --command-digest <sha256> --resume-created-at <iso>',
  )
}

const comments = JSON.parse(await readFile(commentsPath, 'utf8'))
const pauseRun = JSON.parse(await readFile(pauseRunPath, 'utf8'))
const oneShotRun = JSON.parse(await readFile(oneShotRunPath, 'utf8'))
if (!Array.isArray(comments)) throw new Error('issue comments payload must be an array')

const pauseRunId = Number(pauseRunIdText)
const beforeCommentId = Number(beforeCommentIdText)
const jobId = Number(jobIdText)
if (![pauseRunId, beforeCommentId, jobId].every(Number.isSafeInteger)) {
  throw new Error('resume sequence identifiers exceed safe integer range')
}

if (pauseRun.name !== 'R4F G3 Isolated Window') throw new Error('pause run workflow mismatch')
if (pauseRun.event !== 'issue_comment') throw new Error('pause run event mismatch')
if (pauseRun.conclusion !== 'success') throw new Error('pause run is not successful')
if (Number(pauseRun.id) !== pauseRunId) throw new Error('pause run id mismatch')

if (oneShotRun.name !== 'R4F G3 One-Shot Probe') throw new Error('one-shot run workflow mismatch')
if (oneShotRun.event !== 'issue_comment') throw new Error('one-shot run event mismatch')
if (oneShotRun.conclusion !== 'success') throw new Error('one-shot run is not successful')
const oneShotRunId = Number(oneShotRun.id)
if (!Number.isSafeInteger(oneShotRunId) || oneShotRunId <= 0) throw new Error('one-shot run id is invalid')
if (oneShotRun.head_sha !== pauseRun.head_sha) throw new Error('one-shot source commit differs from isolated pause source commit')

const beforeComment = comments.find((comment) => Number(comment?.id) === beforeCommentId)
if (!beforeComment || beforeComment?.user?.login !== 'badjoke-lab' || typeof beforeComment.body !== 'string') {
  throw new Error('BEFORE capture comment is missing or not owner-authored')
}
const beforeRegex = new RegExp(
  `^/r4f-g3-before dashboard_auth=([1-9][0-9]*) pause_run=${pauseRunId} project=${projectDigest} captured_at=([^ ]+) invocations=([0-9]+) artifact=([a-f0-9]{64})$`,
  'u',
)
const beforeMatch = beforeComment.body.match(beforeRegex)
if (!beforeMatch) throw new Error('BEFORE capture command shape mismatch')
const [, dashboardAuthCommentIdText, beforeCapturedAt] = beforeMatch
const dashboardAuthCommentId = Number(dashboardAuthCommentIdText)
if (!Number.isSafeInteger(dashboardAuthCommentId)) throw new Error('dashboard authorization id exceeds safe integer range')

const dashboardComment = comments.find((comment) => Number(comment?.id) === dashboardAuthCommentId)
if (!dashboardComment || dashboardComment?.user?.login !== 'badjoke-lab' || typeof dashboardComment.body !== 'string') {
  throw new Error('dashboard authorization comment is missing or not owner-authored')
}
const dashboardRegex = new RegExp(
  `^/r4f-g3-dashboard-authorize scope=r4f_g3_dashboard_capture commit=([a-f0-9]{40}) project=${projectDigest} job=${jobId} command=${commandDigest} prepare_run=([1-9][0-9]*)$`,
  'u',
)
const dashboardMatch = dashboardComment.body.match(dashboardRegex)
if (!dashboardMatch) throw new Error('resume scheduler identity does not match dashboard authorization')
const [, sourceCommit] = dashboardMatch
if (sourceCommit !== pauseRun.head_sha) throw new Error('dashboard authorization source commit differs from pause run')

const locatorPrefix = '## R4F G3 one-shot probe run'
const runUrlFragment = `/actions/runs/${oneShotRunId}`
const locatorMatches = comments.filter((comment) => {
  if (comment?.user?.login !== 'github-actions[bot]' || typeof comment?.body !== 'string') return false
  return comment.body.includes(locatorPrefix) &&
    comment.body.includes(runUrlFragment) &&
    comment.body.includes('Status: `success`') &&
    comment.body.includes(`Source commit: \`${sourceCommit}\``) &&
    comment.body.includes(`Project identity digest: \`${projectDigest}\``) &&
    comment.body.includes(`Pause run: \`${pauseRunId}\``) &&
    comment.body.includes(`BEFORE capture comment: \`${beforeCommentId}\``)
})
if (locatorMatches.length !== 1) {
  throw new Error(`expected exactly one successful one-shot locator bound to BEFORE, found ${locatorMatches.length}`)
}
const locatorComment = locatorMatches[0]
const authorizationIdMatch = locatorComment.body.match(/Authorization comment: `([1-9][0-9]*)`/u)
if (!authorizationIdMatch) throw new Error('one-shot locator authorization comment id is missing')
const authorizationCommentId = Number(authorizationIdMatch[1])
if (!Number.isSafeInteger(authorizationCommentId)) throw new Error('one-shot authorization id exceeds safe integer range')

const authorizationComment = comments.find((comment) => Number(comment?.id) === authorizationCommentId)
if (!authorizationComment || authorizationComment?.user?.login !== 'badjoke-lab' || typeof authorizationComment.body !== 'string') {
  throw new Error('one-shot authorization comment is missing or not owner-authored')
}
const authorizationRegex = new RegExp(
  `^/r4f-g3-authorize commit=${sourceCommit} ledger=([1-9][0-9]*) project=${projectDigest} prepare_run=([1-9][0-9]*) dashboard_auth=${dashboardAuthCommentId} pause_run=${pauseRunId} before_comment=${beforeCommentId}$`,
  'u',
)
if (!authorizationRegex.test(authorizationComment.body)) {
  throw new Error('one-shot authorization is not bound to the isolated BEFORE sequence')
}

const beforeAt = Date.parse(beforeCapturedAt)
const beforeCommentAt = Date.parse(String(beforeComment.created_at ?? ''))
const authorizationAt = Date.parse(String(authorizationComment.created_at ?? ''))
const runStartAt = Date.parse(String(oneShotRun.run_started_at ?? oneShotRun.created_at ?? ''))
const runEndAt = Date.parse(String(oneShotRun.updated_at ?? ''))
const locatorAt = Date.parse(String(locatorComment.created_at ?? ''))
const resumeAt = Date.parse(resumeCreatedAt)
if (![beforeAt, beforeCommentAt, authorizationAt, runStartAt, runEndAt, locatorAt, resumeAt].every(Number.isFinite)) {
  throw new Error('G3 resume sequence contains an invalid timestamp')
}
if (!(beforeAt <= beforeCommentAt && beforeCommentAt < authorizationAt)) {
  throw new Error('one-shot authorization must follow the retained BEFORE capture')
}
if (!(authorizationAt <= runStartAt && runStartAt <= runEndAt)) {
  throw new Error('successful one-shot run must follow its exact authorization')
}
if (!(runEndAt <= locatorAt && locatorAt < resumeAt)) {
  throw new Error('collector resume must follow the successful one-shot locator')
}

process.stdout.write(`${JSON.stringify({
  sourceCommit,
  projectIdentityDigest: projectDigest,
  schedulerJobId: jobId,
  schedulerCommandDigest: commandDigest,
  dashboardAuthorizationCommentId,
  pauseRun: pauseRunId,
  beforeCommentId,
  oneShotRun: oneShotRunId,
  oneShotAuthorizationCommentId: authorizationCommentId,
  beforeCapturedAt,
  oneShotCompletedAt: String(oneShotRun.updated_at),
  oneShotSucceededBeforeResume: true,
  immediateRestoreAuthorized: true,
})}\n`)
