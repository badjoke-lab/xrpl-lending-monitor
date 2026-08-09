import { readFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const commentsPath = argument('--comments')
const pauseRunPath = argument('--pause-run')
const dashboardAuthCommentIdText = argument('--dashboard-auth-comment-id')
const pauseRunIdText = argument('--pause-run-id')
const beforeCommentIdText = argument('--before-comment-id')
const projectDigest = argument('--project-digest')
const prepareCreatedAt = argument('--prepare-created-at')

const POSITIVE_INTEGER = /^[1-9][0-9]*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u

if (
  !commentsPath ||
  !pauseRunPath ||
  !POSITIVE_INTEGER.test(dashboardAuthCommentIdText ?? '') ||
  !POSITIVE_INTEGER.test(pauseRunIdText ?? '') ||
  !POSITIVE_INTEGER.test(beforeCommentIdText ?? '') ||
  !SHA256.test(projectDigest ?? '') ||
  !prepareCreatedAt ||
  !CANONICAL_UTC.test(prepareCreatedAt)
) {
  throw new Error(
    'usage: verify-r4f-g3-before-sequence --comments <json> --pause-run <json> --dashboard-auth-comment-id <id> --pause-run-id <id> --before-comment-id <id> --project-digest <sha256> --prepare-created-at <iso>',
  )
}

const comments = JSON.parse(await readFile(commentsPath, 'utf8'))
const pauseRun = JSON.parse(await readFile(pauseRunPath, 'utf8'))
if (!Array.isArray(comments)) throw new Error('issue comments payload must be an array')

const dashboardAuthCommentId = Number(dashboardAuthCommentIdText)
const pauseRunId = Number(pauseRunIdText)
const beforeCommentId = Number(beforeCommentIdText)
if (![dashboardAuthCommentId, pauseRunId, beforeCommentId].every(Number.isSafeInteger)) {
  throw new Error('sequence identifiers exceed safe integer range')
}

if (pauseRun.name !== 'R4F G3 Isolated Window') throw new Error('pause run workflow mismatch')
if (pauseRun.event !== 'issue_comment') throw new Error('pause run event mismatch')
if (pauseRun.conclusion !== 'success') throw new Error('pause run is not successful')
if (Number(pauseRun.id) !== pauseRunId) throw new Error('pause run id mismatch')

const dashboardComment = comments.find((comment) => Number(comment?.id) === dashboardAuthCommentId)
if (!dashboardComment || dashboardComment?.user?.login !== 'badjoke-lab' || typeof dashboardComment.body !== 'string') {
  throw new Error('dashboard authorization comment is missing or not owner-authored')
}
const dashboardRegex = /^\/r4f-g3-dashboard-authorize scope=r4f_g3_dashboard_capture commit=([a-f0-9]{40}) project=([a-f0-9]{64}) job=([1-9][0-9]*) command=([a-f0-9]{64}) prepare_run=([1-9][0-9]*)$/u
const dashboardMatch = dashboardComment.body.match(dashboardRegex)
if (!dashboardMatch) throw new Error('dashboard authorization command shape mismatch')
const [, commit, dashboardProjectDigest, jobId, commandDigest, isolationPrepareRun] = dashboardMatch
if (dashboardProjectDigest !== projectDigest) throw new Error('dashboard authorization project identity mismatch')
if (pauseRun.head_sha !== commit) throw new Error('pause run source commit mismatch')

const exactPauseCommand = `/r4f-g3-isolation-pause commit=${commit} project=${projectDigest} job=${jobId} command=${commandDigest} prepare_run=${isolationPrepareRun} dashboard_auth=${dashboardAuthCommentId}`
const pauseAuthorizationMatches = comments.filter(
  (comment) => comment?.user?.login === 'badjoke-lab' && comment?.body === exactPauseCommand,
)
if (pauseAuthorizationMatches.length !== 1) {
  throw new Error(`expected exactly one pause authorization bound to dashboard authorization, found ${pauseAuthorizationMatches.length}`)
}
const pauseAuthorizationComment = pauseAuthorizationMatches[0]

const beforeComment = comments.find((comment) => Number(comment?.id) === beforeCommentId)
if (!beforeComment || beforeComment?.user?.login !== 'badjoke-lab' || typeof beforeComment.body !== 'string') {
  throw new Error('BEFORE capture comment is missing or not owner-authored')
}
const beforeRegex = new RegExp(
  `^/r4f-g3-before dashboard_auth=${dashboardAuthCommentId} pause_run=${pauseRunId} project=${projectDigest} captured_at=([^ ]+) invocations=([0-9]+) artifact=([a-f0-9]{64})$`,
  'u',
)
const beforeMatch = beforeComment.body.match(beforeRegex)
if (!beforeMatch) throw new Error('BEFORE capture command shape mismatch')
const [, beforeCapturedAt, beforeInvocationsText, beforeArtifactDigest] = beforeMatch
if (!CANONICAL_UTC.test(beforeCapturedAt)) throw new Error('BEFORE captured_at must be canonical UTC')
if (beforeArtifactDigest === '0'.repeat(64)) throw new Error('BEFORE artifact digest must not be a placeholder')
const beforeInvocations = Number(beforeInvocationsText)
if (!Number.isSafeInteger(beforeInvocations) || beforeInvocations < 0) throw new Error('BEFORE invocation count is invalid')

const dashboardAt = Date.parse(String(dashboardComment.created_at ?? ''))
const pauseAuthorizationAt = Date.parse(String(pauseAuthorizationComment.created_at ?? ''))
const pauseRunCreatedAt = Date.parse(String(pauseRun.created_at ?? ''))
const pauseRunFinishedAt = Date.parse(String(pauseRun.updated_at ?? ''))
const beforeAt = Date.parse(beforeCapturedAt)
const beforeCommentAt = Date.parse(String(beforeComment.created_at ?? ''))
const prepareAt = Date.parse(prepareCreatedAt)
if (![dashboardAt, pauseAuthorizationAt, pauseRunCreatedAt, pauseRunFinishedAt, beforeAt, beforeCommentAt, prepareAt].every(Number.isFinite)) {
  throw new Error('G3 BEFORE sequence contains an invalid timestamp')
}
if (!(dashboardAt < pauseAuthorizationAt)) throw new Error('dashboard authorization must precede pause authorization')
if (!(pauseAuthorizationAt <= pauseRunCreatedAt)) throw new Error('pause authorization must precede the pause run')
if (!(pauseRunFinishedAt <= beforeAt)) throw new Error('BEFORE capture must follow completed isolation pause')
if (!(beforeAt <= beforeCommentAt)) throw new Error('BEFORE capture marker predates its captured_at value')
if (!(beforeCommentAt < prepareAt)) throw new Error('one-shot prepare must follow the retained BEFORE capture')

process.stdout.write(`${JSON.stringify({
  sourceCommit: commit,
  projectIdentityDigest: projectDigest,
  isolationPrepareRun: Number(isolationPrepareRun),
  schedulerJobId: Number(jobId),
  schedulerCommandDigest: commandDigest,
  dashboardAuthorizationCommentId: dashboardAuthCommentId,
  pauseAuthorizationCommentId: Number(pauseAuthorizationComment.id),
  pauseRun: pauseRunId,
  beforeCommentId,
  beforeCapturedAt,
  beforeInvocations,
  beforeArtifactDigest,
  dashboardAuthorizationPrecedesPause: true,
  pausePrecedesBefore: true,
  beforePrecedesOneShotPrepare: true,
})}\n`)
