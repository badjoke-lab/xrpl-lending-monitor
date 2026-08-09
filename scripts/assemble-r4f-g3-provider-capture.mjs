import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const PROFILE_ID = 'supabase_free_postgres_pgcron_edge'
const PROFILE_REVISION = 4
const PROFILE_DIGEST = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const PROJECT_DIGEST = '81378864f4d6650a60a2c09a95629a18780d49fc23836e0f6a024b70f13f88a8'
const SHA256 = /^[a-f0-9]{64}$/u
const COMMIT = /^[a-f0-9]{40}$/u
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const DISPLAY_VALUE = /^\d+(?:\.\d+)?$/u
const ALLOWED_UNITS = new Set(['bytes', 'kB', 'MB', 'GB', 'KiB', 'MiB', 'GiB'])
const ALLOWED_ROUNDING = new Set(['exact', 'nearest_half_up', 'truncate_down'])

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative safe integer`)
  return parsed
}

function canonicalUtc(value, name) {
  if (typeof value !== 'string' || !UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be canonical UTC`)
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function exactComment(comments, id, actor = 'badjoke-lab') {
  const matches = comments.filter((comment) => Number(comment?.id) === id)
  if (matches.length !== 1) throw new Error(`expected exactly one issue comment ${id}`)
  const comment = matches[0]
  if (comment?.user?.login !== actor || typeof comment?.body !== 'string') {
    throw new Error(`issue comment ${id} actor/body mismatch`)
  }
  return comment
}

export function assembleR4fG3ProviderCapture({
  afterSequence,
  comments,
  oneShotSummary,
  logWindow,
  billingPeriodStart,
  billingPeriodEnd,
  beforeEgress,
  afterEgress,
  unit,
  decimalPlaces,
  roundingRule,
  retainedReserveBytes = 0,
}) {
  if (!afterSequence || !Array.isArray(comments) || !oneShotSummary || !logWindow) {
    throw new Error('formal G3 assembly inputs are incomplete')
  }
  const oneShotRun = positiveInteger(afterSequence.oneShotRun, 'oneShotRun')
  const dashboardAuthId = positiveInteger(afterSequence.dashboardAuthorizationCommentId, 'dashboardAuthorizationCommentId')
  const beforeCommentId = positiveInteger(afterSequence.beforeCommentId, 'beforeCommentId')
  const afterCommentId = positiveInteger(afterSequence.afterCommentId, 'afterCommentId')
  if (afterSequence.projectIdentityDigest !== PROJECT_DIGEST) throw new Error('after-sequence project identity mismatch')
  if (afterSequence.usageFresh !== true || nonNegativeInteger(afterSequence.invocationDelta, 'invocationDelta') < 1) {
    throw new Error('provider Usage freshness is not qualified')
  }

  if (oneShotSummary.schemaVersion !== 1 || oneShotSummary.qualificationIssue !== 1261) {
    throw new Error('one-shot summary identity mismatch')
  }
  if (oneShotSummary.runId !== oneShotRun) throw new Error('one-shot summary run mismatch')
  if (oneShotSummary.projectIdentityDigest !== PROJECT_DIGEST) throw new Error('one-shot summary project mismatch')
  if (oneShotSummary.profileIdentityDigest !== PROFILE_DIGEST) throw new Error('one-shot summary profile mismatch')
  if (!COMMIT.test(oneShotSummary.sourceCommit ?? '')) throw new Error('one-shot source commit is invalid')
  if (!SHA256.test(oneShotSummary.accountingDigest ?? '') || oneShotSummary.accountingDigest === '0'.repeat(64)) {
    throw new Error('one-shot accounting digest is invalid')
  }
  const applicationUpper = nonNegativeInteger(
    oneShotSummary.rollingBillableEgressUpperBoundBytes,
    'rollingBillableEgressUpperBoundBytes',
  )
  const retainedReserve = nonNegativeInteger(retainedReserveBytes, 'retainedReserveBytes')

  const dashboardComment = exactComment(comments, dashboardAuthId)
  const authRegex = /^\/r4f-g3-dashboard-authorize scope=r4f_g3_dashboard_capture commit=([a-f0-9]{40}) project=([a-f0-9]{64}) job=([1-9][0-9]*) command=([a-f0-9]{64}) prepare_run=([1-9][0-9]*)$/u
  const authMatch = dashboardComment.body.match(authRegex)
  if (!authMatch) throw new Error('dashboard authorization command shape mismatch')
  const [, authorizedCommit, authorizedProject] = authMatch
  if (authorizedCommit !== oneShotSummary.sourceCommit || authorizedProject !== PROJECT_DIGEST) {
    throw new Error('dashboard authorization is not bound to the one-shot evidence')
  }
  const authorizationCreatedAt = canonicalUtc(String(dashboardComment.created_at ?? ''), 'dashboard authorization created_at')

  if (logWindow.schemaVersion !== 1 || logWindow.purpose !== 'r4f-g3-concurrent-traffic-log-window') {
    throw new Error('concurrent-traffic evidence identity mismatch')
  }
  if (logWindow.targetRun !== oneShotRun || logWindow.projectIdentityDigest !== PROJECT_DIGEST) {
    throw new Error('concurrent-traffic evidence target mismatch')
  }
  if (
    logWindow.interval?.start !== afterSequence.beforeCapturedAt ||
    logWindow.interval?.end !== afterSequence.afterCapturedAt
  ) {
    throw new Error('concurrent-traffic interval is not the verified provider interval')
  }
  const classification = logWindow.classification ?? {}
  const concurrentExcluded =
    classification.noOtherFunctionRequestsObserved === true &&
    nonNegativeInteger(classification.otherFunctionRequestCount, 'otherFunctionRequestCount') === 0 &&
    nonNegativeInteger(classification.otherNetworkRequestCount, 'otherNetworkRequestCount') === 0
  if (!concurrentExcluded) throw new Error('concurrent provider traffic was observed in the G3 interval')
  const logText = `${JSON.stringify(logWindow, null, 2)}\n`
  const logDigest = sha256(logText)

  if (!DISPLAY_VALUE.test(beforeEgress ?? '') || !DISPLAY_VALUE.test(afterEgress ?? '')) {
    throw new Error('BEFORE/AFTER egress must be unsigned decimal display values')
  }
  const decimals = nonNegativeInteger(decimalPlaces, 'decimalPlaces')
  if (decimals > 9) throw new Error('decimalPlaces must not exceed 9')
  const expectedDisplay = decimals === 0 ? /^\d+$/u : new RegExp(`^\\d+\\.\\d{${decimals}}$`, 'u')
  if (!expectedDisplay.test(beforeEgress) || !expectedDisplay.test(afterEgress)) {
    throw new Error('egress display values do not match decimalPlaces')
  }
  if (!ALLOWED_UNITS.has(unit)) throw new Error('provider display unit is unsupported')
  if (!ALLOWED_ROUNDING.has(roundingRule)) throw new Error('provider display rounding rule is unsupported')
  const periodStart = canonicalUtc(billingPeriodStart, 'billingPeriodStart')
  const periodEnd = canonicalUtc(billingPeriodEnd, 'billingPeriodEnd')
  if (Date.parse(periodStart) >= Date.parse(periodEnd)) throw new Error('billing period must have positive duration')

  canonicalUtc(afterSequence.beforeCapturedAt, 'beforeCapturedAt')
  canonicalUtc(afterSequence.afterCapturedAt, 'afterCapturedAt')
  if (!SHA256.test(afterSequence.beforeArtifactDigest ?? '') || afterSequence.beforeArtifactDigest === '0'.repeat(64)) {
    throw new Error('BEFORE screenshot digest is invalid')
  }
  if (!SHA256.test(afterSequence.afterArtifactDigest ?? '') || afterSequence.afterArtifactDigest === '0'.repeat(64)) {
    throw new Error('AFTER screenshot digest is invalid')
  }

  const beforeInvocations = nonNegativeInteger(afterSequence.beforeInvocations, 'beforeInvocations')
  const afterInvocations = nonNegativeInteger(afterSequence.afterInvocations, 'afterInvocations')
  if (afterInvocations - beforeInvocations < 1) throw new Error('provider invocation freshness was lost during assembly')

  const authDigest = sha256(dashboardComment.body)
  const captureId = `r4f-g3-live-${oneShotRun}`
  return {
    schemaVersion: 1,
    profileId: PROFILE_ID,
    profileRevision: PROFILE_REVISION,
    profileIdentityDigest: PROFILE_DIGEST,
    captureState: 'authorized_dashboard_capture',
    captureId,
    authorization: {
      issueNumber: 1261,
      commentId: dashboardAuthId,
      actor: 'badjoke-lab',
      scope: 'r4f_g3_dashboard_capture',
      sourceCommit: oneShotSummary.sourceCommit,
      createdAt: authorizationCreatedAt,
      evidenceArtifact: `issue-1261-dashboard-authorization-comment-${dashboardAuthId}.txt`,
      evidenceDigest: authDigest,
    },
    projectIdentityDigest: PROJECT_DIGEST,
    providerSurface: {
      source: 'organization_usage_page',
      metric: 'total_egress',
      projectFilterApplied: true,
      selectedProjectIdentityDigest: PROJECT_DIGEST,
      billingPeriodFilterApplied: true,
      cachedEgressIncluded: true,
    },
    billingPeriodStart: periodStart,
    billingPeriodEnd: periodEnd,
    before: {
      displayedValue: beforeEgress,
      unit,
      decimalPlaces: decimals,
      roundingRule,
      capturedAt: afterSequence.beforeCapturedAt,
      sourceArtifact: `supabase-usage-before-comment-${beforeCommentId}.png`,
      sourceArtifactDigest: afterSequence.beforeArtifactDigest,
    },
    after: {
      displayedValue: afterEgress,
      unit,
      decimalPlaces: decimals,
      roundingRule,
      capturedAt: afterSequence.afterCapturedAt,
      sourceArtifact: `supabase-usage-after-comment-${afterCommentId}.png`,
      sourceArtifactDigest: afterSequence.afterArtifactDigest,
    },
    providerUsageFreshness: {
      beforeEdgeFunctionInvocations: beforeInvocations,
      afterEdgeFunctionInvocations: afterInvocations,
    },
    application: {
      rollingBillableEgressUpperBoundBytes: applicationUpper,
      retainedUnexplainedDeltaReserveBytes: retainedReserve,
      accountingDigest: oneShotSummary.accountingDigest,
      sourceCommit: oneShotSummary.sourceCommit,
      sourceRunId: oneShotRun,
    },
    concurrentTraffic: {
      excluded: true,
      evidenceArtifacts: ['r4f-g3-concurrent-traffic-evidence/log-window.json'],
      evidenceArtifactDigests: [logDigest],
    },
    providerCapabilities: {
      managementApiEgressBytesAvailable: false,
      dashboardPatAuthorized: false,
      dashboardExactByteExportAvailable: false,
      logsResponseBytesAvailable: false,
    },
    safety: {
      providerMutationPerformed: false,
      productionMigrationPerformed: false,
      recoveryMutationCommitted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
}

async function main() {
  const afterSequencePath = argument('--after-sequence')
  const commentsPath = argument('--comments')
  const oneShotSummaryPath = argument('--one-shot-summary')
  const logWindowPath = argument('--log-window')
  const outputPath = argument('--output')
  if (!afterSequencePath || !commentsPath || !oneShotSummaryPath || !logWindowPath || !outputPath) {
    throw new Error('formal G3 assembly requires --after-sequence --comments --one-shot-summary --log-window --output')
  }
  const [afterSequence, comments, oneShotSummary, logWindow] = await Promise.all([
    readFile(afterSequencePath, 'utf8').then(JSON.parse),
    readFile(commentsPath, 'utf8').then(JSON.parse),
    readFile(oneShotSummaryPath, 'utf8').then(JSON.parse),
    readFile(logWindowPath, 'utf8').then(JSON.parse),
  ])
  const result = assembleR4fG3ProviderCapture({
    afterSequence,
    comments,
    oneShotSummary,
    logWindow,
    billingPeriodStart: argument('--billing-start'),
    billingPeriodEnd: argument('--billing-end'),
    beforeEgress: argument('--before-egress'),
    afterEgress: argument('--after-egress'),
    unit: argument('--unit'),
    decimalPlaces: argument('--decimals'),
    roundingRule: argument('--rounding'),
    retainedReserveBytes: argument('--retained-reserve') ?? 0,
  })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ captureId: result.captureId, sourceRunId: result.application.sourceRunId, output: outputPath })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
