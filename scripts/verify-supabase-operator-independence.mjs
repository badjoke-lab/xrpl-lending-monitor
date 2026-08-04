import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const runIdText = process.env.GITHUB_RUN_ID ?? ''
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()
if (!/^[1-9][0-9]*$/u.test(runIdText)) throw new Error('GITHUB_RUN_ID must be a positive integer')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('GITHUB_SHA must be an exact lowercase commit SHA')
const sourceRunId = Number(runIdText)
if (!Number.isSafeInteger(sourceRunId)) throw new Error('GITHUB_RUN_ID exceeds the safe integer range')

const evidenceDirectory = 'supabase-remote-probe-evidence'
const workflowPath = '.github/workflows/supabase-remote-probe.yml'
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 3
const profileIdentityDigest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function requireTrue(value, name) {
  if (value !== true) throw new Error(`${name} must be true`)
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

async function readEvidence(name) {
  return object(
    JSON.parse(await readFile(`${evidenceDirectory}/${name}`, 'utf8')),
    name,
  )
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const [workflow, completeState, continuation, remoteFault, revision3Accounting] =
    await Promise.all([
      readFile(workflowPath, 'utf8'),
      readEvidence('verified-complete-state-transfer.json'),
      readEvidence('verified-restore-continuation.json'),
      readEvidence('verified-remote-fault-qualification.json'),
      readEvidence('verified-revision3-accounting.json'),
    ])

  const expectedFunctionDeployments = [
    'xrpl-collector-tick',
    'xrpl-committed-reader',
    'xrpl-historical-witness',
    'xrpl-historical-witness-reader',
    'xrpl-multichunk-witness',
    'xrpl-multichunk-witness-reader',
    'xrpl-complete-state-transfer',
    'xrpl-restore-continuation',
    'xrpl-remote-fault-qualification',
    'xrpl-throughput-resource-baseline',
    'xrpl-catchup-throughput',
    'xrpl-steady-batch-tick',
    'xrpl-steady-throughput-qualification',
    'xrpl-resource-headroom-guard',
    'xrpl-r5-recovery-batch',
    'xrpl-r5-recovery-batch-trigger',
  ]
  for (const slug of expectedFunctionDeployments) {
    if (!workflow.includes(`supabase functions deploy ${slug} `)) {
      throw new Error(`workflow is missing scripted deployment for ${slug}`)
    }
  }
  if (count(workflow, /supabase functions deploy /gu) !== expectedFunctionDeployments.length) {
    throw new Error('workflow function deployment count changed')
  }

  const deploymentChecks = {
    repositoryCheckout: workflow.includes('uses: actions/checkout@v4'),
    pinnedSupabaseSetupAction: workflow.includes('uses: supabase/setup-cli@'),
    exactProjectLink: workflow.includes('supabase link --project-ref "$SUPABASE_PROJECT_ID"'),
    migrationApply: workflow.includes('supabase db push --linked --yes'),
    exactFunctionDeploymentSet: true,
    noRoutineDashboardStep: !/dashboard|browser login|interactive login/iu.test(workflow),
  }
  for (const [key, value] of Object.entries(deploymentChecks)) requireTrue(value, `deployment.${key}`)

  const credentialChecks = {
    exactlyTwoTokensGenerated:
      count(workflow, /openssl rand -hex 32/gu) === 2,
    readerTokenMasked: workflow.includes('echo "::add-mask::${reader_token}"'),
    recoveryTokenMasked: workflow.includes('echo "::add-mask::${recovery_token}"'),
    readerTokenRotatedExactlyOnce:
      count(workflow, /supabase secrets set XRPL_READER_VERIFY_TOKEN/gu) === 1,
    recoveryTokenRotatedExactlyOnce:
      count(workflow, /supabase secrets set XRPL_R5_RECOVERY_VERIFY_TOKEN/gu) === 1,
    readerTokenExportedExactlyOnce:
      count(workflow, /echo "XRPL_READER_VERIFY_TOKEN=\$\{reader_token\}"/gu) === 1,
    recoveryTokenExportedExactlyOnce:
      count(workflow, /echo "XRPL_R5_RECOVERY_VERIFY_TOKEN=\$\{recovery_token\}"/gu) === 1,
    tokenScopedToExactProject:
      count(workflow, /supabase secrets set XRPL_(?:READER|R5_RECOVERY)_VERIFY_TOKEN=.*--project-ref "\$SUPABASE_PROJECT_ID"/gu) === 2,
  }
  for (const [key, value] of Object.entries(credentialChecks)) requireTrue(value, `credential.${key}`)

  if (
    completeState.purpose !== 'r4c2c-complete-state-transfer-remote-verification'
    || !/^[a-f0-9]{64}$/u.test(String(completeState.stateDigest ?? ''))
    || !Number.isSafeInteger(completeState.canonicalTextBytes)
    || completeState.canonicalTextBytes < 1
  ) {
    throw new Error('complete-state checkpoint identity is invalid')
  }
  for (const key of [
    'collectionStateIncluded',
    'schedulerStateIncluded',
    'publicationStateIncluded',
    'maintenanceStateIncluded',
    'canonicalTextParity',
    'digestParity',
    'duplicateRestoreConverged',
    'digestTamperRejected',
    'activeProfileIsolated',
  ]) requireTrue(completeState.checks?.[key], `completeState.${key}`)

  const emptyTargetRestoreObserved = completeState.emptyTargetRestoreObserved === true
  const exactDuplicateRestoreObserved =
    completeState.firstRestoreDuplicate === true
    && completeState.duplicateRestoreConverged === true
    && completeState.checks?.duplicateRestoreConverged === true
    && completeState.checks?.canonicalTextParity === true
    && completeState.checks?.digestParity === true
  if (!emptyTargetRestoreObserved && !exactDuplicateRestoreObserved) {
    throw new Error('complete-state restore was neither an empty-target restore nor an exact duplicate convergence')
  }
  requireTrue(completeState.activeIsolation?.nonRegressing, 'completeState.activeNonRegressing')
  requireTrue(
    completeState.activeIsolation?.sourceIdentityPreserved,
    'completeState.activeSourceIdentityPreserved',
  )

  if (
    continuation.purpose !== 'r4c2c-restore-continuation-remote-verification'
    || !/^[a-f0-9]{64}$/u.test(String(continuation.sourceStateDigest ?? ''))
    || !/^[a-f0-9]{64}$/u.test(String(continuation.targetStateDigest ?? ''))
  ) {
    throw new Error('restore continuation identity is invalid')
  }
  for (const key of [
    'emptyTargetRestoreParity',
    'pendingScanRestored',
    'standardPhaseContinuation',
    'watermarkAdvancedExactlyOne',
    'committedRowParity',
    'explicitSourceRebinding',
    'duplicatePhaseReplayConverged',
    'activeProfileIsolated',
    'postRestoreContinuationProved',
  ]) requireTrue(continuation.checks?.[key], `continuation.${key}`)
  requireTrue(continuation.activeIsolation?.nonRegressing, 'continuation.activeNonRegressing')
  requireTrue(
    continuation.activeIsolation?.sourceIdentityPreserved,
    'continuation.activeSourceIdentityPreserved',
  )

  if (remoteFault.purpose !== 'r4c2c-remote-fault-qualification-verification') {
    throw new Error('remote fault qualification identity is invalid')
  }
  for (const key of [
    'interruptionRollbackProved',
    'retryBackoffProved',
    'staleLeaseReclaimProved',
    'terminalFailClosedHaltProved',
    'terminalReplayConverged',
    'activeProfileIsolated',
    'remoteFaultQualificationProved',
  ]) requireTrue(remoteFault.checks?.[key], `remoteFault.${key}`)
  if (
    remoteFault.stream?.status !== 'halted'
    || remoteFault.stream?.last_error_classification !== 'integrity'
    || !Array.isArray(remoteFault.eventTypes)
    || !remoteFault.eventTypes.includes('rollback-observed')
    || !remoteFault.eventTypes.includes('terminal-halt')
    || !Array.isArray(remoteFault.successors)
    || remoteFault.successors.length !== 0
  ) {
    throw new Error('remote rollback or terminal halt evidence changed')
  }
  requireTrue(remoteFault.activeIsolation?.nonRegressing, 'remoteFault.activeNonRegressing')
  requireTrue(
    remoteFault.activeIsolation?.sourceIdentityPreserved,
    'remoteFault.activeSourceIdentityPreserved',
  )

  if (
    revision3Accounting.purpose !== 'r4c3-supabase-revision3-accounting-verification'
    || revision3Accounting.sourceRunId !== sourceRunId
    || revision3Accounting.sourceCommit !== sourceCommit
    || revision3Accounting.profileId !== profileId
    || revision3Accounting.profileRevision !== profileRevision
    || revision3Accounting.profileIdentityDigest !== profileIdentityDigest
    || revision3Accounting.completedTicks !== 6
    || revision3Accounting.committedLedgers !== 144
    || revision3Accounting.unsafeAccountingAttempts !== 0
  ) {
    throw new Error('revision-3 accounting operator evidence identity changed')
  }
  for (const key of [
    'guardedSixMinuteSessionCompleted',
    'exact144LedgerAdvance',
    'oneSafeLatestAccountingPerCompletedTick',
    'accountingRecordedBeforeCompletion',
    'allConservativeBoundsBelowProjectHalts',
    'allSevenInjectedPrecommitFailuresRejected',
    'noInjectedStateMutation',
    'activeProfileReadOnly',
    'missingTokenRejected',
    'wrongPurposeRejected',
    'unavailableProviderMemoryNotClaimed',
    'unavailableProviderEgressNotClaimed',
  ]) requireTrue(revision3Accounting.checks?.[key], `revision3Accounting.${key}`)

  const evidencePublicationChecks = {
    alwaysUploadEvidence: workflow.includes('- name: Upload sanitized remote evidence\n        if: always()'),
    alwaysPublishLocator: workflow.includes('- name: Publish sanitized run locator\n        if: always()'),
    artifactRetentionBounded: workflow.includes('retention-days: 7'),
    issueCommentExactlyOnce: count(workflow, /gh issue comment 1109/gu) === 1,
    singleWorkflowConcurrency: workflow.includes('group: supabase-remote-probe-deploy'),
    concurrentRunsNotCancelled: workflow.includes('cancel-in-progress: false'),
  }
  for (const [key, value] of Object.entries(evidencePublicationChecks)) {
    requireTrue(value, `evidencePublication.${key}`)
  }

  const checkpoint = {
    stateDigest: completeState.stateDigest,
    canonicalTextBytes: completeState.canonicalTextBytes,
    rowCounts: completeState.rowCounts,
    schedulerStatusCounts: completeState.schedulerStatusCounts,
    restorePath: emptyTargetRestoreObserved ? 'empty_target' : 'exact_duplicate_convergence',
    emptyTargetRestoreObserved,
    exactDuplicateRestoreObserved,
  }
  const rollback = {
    transactionRollbackProved: remoteFault.checks.interruptionRollbackProved,
    rollbackEventRetained: remoteFault.eventTypes.includes('rollback-observed'),
    rollbackSentinelAbsent: !remoteFault.eventTypes.includes('rollback-sentinel'),
    restoredCheckpointDigest: continuation.sourceStateDigest,
    postRestoreTargetDigest: continuation.targetStateDigest,
    exactContinuationAfterRestore: continuation.checks.postRestoreContinuationProved,
  }
  const halt = {
    terminalStatus: remoteFault.stream.status,
    classification: remoteFault.stream.last_error_classification,
    terminalHaltProved: remoteFault.checks.terminalFailClosedHaltProved,
    invalidSuccessorsReserved: remoteFault.successors.length,
  }
  const revision3 = {
    sessionId: revision3Accounting.sessionId,
    qualificationId: revision3Accounting.qualificationId,
    completedTicks: revision3Accounting.completedTicks,
    committedLedgers: revision3Accounting.committedLedgers,
    accountingAttempts: revision3Accounting.accountingAttempts,
    allowedAccountingAttempts: revision3Accounting.allowedAccountingAttempts,
    unsafeAccountingAttempts: revision3Accounting.unsafeAccountingAttempts,
    injectedGuardKinds: revision3Accounting.injectedGuardKinds,
  }

  const evidenceCore = {
    schemaVersion: 1,
    purpose: 'r4c3-supabase-operator-independence',
    sourceRunId,
    sourceCommit,
    profileId,
    profileRevision,
    profileIdentityDigest,
    workflowPath,
    expectedFunctionDeployments,
    deploymentChecks,
    credentialChecks,
    checkpoint,
    rollback,
    halt,
    revision3,
    evidencePublicationChecks,
    activeIsolation: {
      completeState: completeState.activeIsolation,
      continuation: continuation.activeIsolation,
      remoteFault: remoteFault.activeIsolation,
    },
    checks: {
      deployScripted: true,
      rollbackScriptedAndRemotelyProved: true,
      checkpointScriptedAndRemotelyProved: true,
      exportScriptedAndRemotelyProved: true,
      restoreScriptedAndRemotelyProved: true,
      repeatableRestoreConvergenceProved: true,
      evidenceScripted: true,
      haltScriptedAndRemotelyProved: true,
      credentialRotationScripted: true,
      noRoutineDashboardOrTerminalOperation: true,
      revision3AccountingRemotelyProved: true,
      exactProfileRevisionBound: true,
      activeProfileReadOnly: true,
      g9Qualified: true,
      g8Qualified: false,
      profileSelected: false,
    },
  }
  const evidence = { ...evidenceCore, evidenceDigest: digest(evidenceCore) }

  await writeFile(
    `${evidenceDirectory}/verified-operator-independence.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r4c3-supabase-operator-independence',
    sourceRunId,
    sourceCommit,
    profileId,
    profileRevision,
    profileIdentityDigest,
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
    checks: {
      g9Qualified: false,
      g8Qualified: false,
      profileSelected: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-operator-independence.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
