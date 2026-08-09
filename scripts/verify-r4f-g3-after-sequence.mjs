import { readFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const commentsPath = argument('--comments')
const oneShotRunPath = argument('--one-shot-run')
const resumeRunPath = argument('--resume-run')
const pauseRunIdText = argument('--pause-run-id')
const beforeCommentIdText = argument('--before-comment-id')
const afterCommentIdText = argument('--after-comment-id')
const projectDigest = argument('--project-digest')

const POSITIVE_INTEGER = /^[1-9][0-9]*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u

if (
  !commentsPath ||
  !oneShotRunPath ||
  !resumeRunPath ||
  !POSITIVE_INTEGER.test(pauseRunIdText ?? '') ||
  !POSITIVE_INTEGER.test(beforeCommentIdText ?? '') ||
  !POSITIVE_INTEGER.test(afterCommentIdText ?? '') ||
  !SHA256.test(projectDigest ?? '')
) {
  throw new Error(
    'usage: verify-r4f-g3-after-sequence --comments <json> --one-shot-run <json> --resume-run <json> --pause-run-id <id> --before-comment-id <id> --after-comment-id <id> --project-digest <sha256>',
  )
}

const comments = JSON.parse(await readFile(commentsPath, 'utf8'))
const oneShotRun = JSON.parse(await readFile(oneShotRunPath, 'utf8'))
const resumeRun = JSON.parse(await readFile(resumeRunPath, 'utf8'))
if (!Array.isArray(comments)) throw new Error('issue comments payload must be an array')

const pauseRunId = Number(pauseRunIdText)
const beforeCommentId = Number(beforeCommentIdText)
const afterCommentId = Number(afterCommentIdText)
if (![pauseRunId, beforeCommentId, afterCommentId].every(Number.isSafeInteger)) {
  throw new Error('sequence identifiers exceed safe integer range')
}

if (oneShotRun.name !== 'R4F G3 One-Shot Probe') throw new Error('one-shot run workflow mismatch')
if (oneShotRun.event !== 'issue_comment') throw new Error('one-shot run event mismatch')
if (oneShotRun.conclusion !== 'success') throw new Error('one-shot run is not successful')
const oneShotRunId = Number(oneShotRun.id)
if (!Number.isSafeInteger(oneShotRunId) || oneShotRunId <= 0) throw new Error('one-shot run id is invalid')

if (resumeRun.name !== 'R4F G3 Isolated Window') throw new Error('resume run workflow mismatch')
if (resumeRun.event !== 'issue_comment') throw new Error('resume run event mismatch')
if (resumeRun.conclusion !== 'success') throw new Error('resume run is not successful')
const resumeRunId = Number(resumeRun.id)
if (!Number.isSafeInteger(resumeRunId) || resumeRunId <= 0) throw new Error('resume run id is invalid')

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
const [, dashboardAuthCommentIdText, beforeCapturedAt, beforeInvocationsText, beforeArtifactDigest] = beforeMatch

const afterComment = comments.find((comment) => Number(comment?.id) === afterCommentId)
if (!afterComment || afterComment?.user?.login !== 'badjoke-lab' || typeof afterComment.body !== 'string') {
  throw new Error('AFTER capture comment is missing or not owner-authored')
}
const afterRegex = new RegExp(
  `^/r4f-g3-after run=${oneShotRunId} pause_run=${pauseRunId} resume_run=${resumeRunId} before_comment=${beforeCommentId} project=${projectDigest} captured_at=([^ ]+) invocations=([0-9]+) artifact=([a-f0-9]{64})$`,
  'u',
)
const afterMatch = afterComment.body.match(afterRegex)
if (!afterMatch) throw new Error('AFTER capture command shape mismatch')
const [, afterCapturedAt, afterInvocationsText, afterArtifactDigest] = afterMatch
if (!CANONICAL_UTC.test(beforeCapturedAt) || !CANONICAL_UTC.test(afterCapturedAt)) {
  throw new Error('BEFORE/AFTER captured_at must be canonical UTC')
}
if (beforeArtifactDigest === '0'.repeat(64) || afterArtifactDigest === '0'.repeat(64)) {
  throw new Error('BEFORE/AFTER artifact digest must not be a placeholder')
}

const beforeInvocations = Number(beforeInvocationsText)
const afterInvocations = Number(afterInvocationsText)
if (![beforeInvocations, afterInvocations].every((value) => Number.isSafeInteger(value) && value >= 0)) {
  throw new Error('BEFORE/AFTER invocation count is invalid')
}
const invocationDelta = afterInvocations - beforeInvocations
if (invocationDelta < 1) {
  throw new Error('Supabase Usage is not fresh: AFTER invocations must increase by at least one')
}

const beforeAt = Date.parse(beforeCapturedAt)
const beforeCommentAt = Date.parse(String(beforeComment.created_at ?? ''))
const runStartAt = Date.parse(String(oneShotRun.run_started_at ?? oneShotRun.created_at ?? ''))
const runEndAt = Date.parse(String(oneShotRun.updated_at ?? ''))
const resumeStartAt = Date.parse(String(resumeRun.run_started_at ?? resumeRun.created_at ?? ''))
const resumeEndAt = Date.parse(String(resumeRun.updated_at ?? ''))
const afterAt = Date.parse(afterCapturedAt)
const afterCommentAt = Date.parse(String(afterComment.created_at ?? ''))
if (![beforeAt, beforeCommentAt, runStartAt, runEndAt, resumeStartAt, resumeEndAt, afterAt, afterCommentAt].every(Number.isFinite)) {
  throw new Error('G3 AFTER sequence contains an invalid timestamp')
}
if (!(beforeAt <= beforeCommentAt && beforeCommentAt < runStartAt)) {
  throw new Error('one-shot run must follow the retained BEFORE capture')
}
if (!(runStartAt <= runEndAt && runEndAt <= resumeStartAt)) {
  throw new Error('collector resume must follow the completed one-shot run')
}
if (!(resumeStartAt <= resumeEndAt && resumeEndAt <= afterAt)) {
  throw new Error('AFTER capture must follow successful collector resume')
}
if (!(afterAt <= afterCommentAt)) {
  throw new Error('AFTER capture marker predates its captured_at value')
}

process.stdout.write(`${JSON.stringify({
  oneShotRun: oneShotRunId,
  pauseRun: pauseRunId,
  resumeRun: resumeRunId,
  dashboardAuthorizationCommentId: Number(dashboardAuthCommentIdText),
  beforeCommentId,
  afterCommentId,
  projectIdentityDigest: projectDigest,
  beforeCapturedAt,
  afterCapturedAt,
  beforeInvocations,
  afterInvocations,
  invocationDelta,
  beforeArtifactDigest,
  afterArtifactDigest,
  usageFresh: true,
  oneShotPrecedesResume: true,
  resumePrecedesAfter: true,
})}\n`)
