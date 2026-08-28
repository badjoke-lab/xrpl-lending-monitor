#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const STABLE_GUARD_PATH = 'ops/production-sql/20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json'
const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const DATABASE_HALT_BYTES = 400_000_000
const PROJECT_EGRESS_HALT_31D_BYTES = 4 * 1024 * 1024 * 1024
const PROJECT_MEMORY_HALT_BYTES = 224 * 1024 * 1024
const PROJECT_INVOCATION_HALT_31D = 400_000
const MIN_CAPACITY_RESERVE_WINDOWS = 14
const CAPACITY_QUALIFICATION_PURPOSE = 'r5-free-operation-capacity-readonly-qualification'

function fail(message) { throw new Error(message) }
function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index]
    const value = argv[index + 1]
    if (!token?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${token ?? '<end>'}`)
    options[token.slice(2)] = value
  }
  return options
}
async function readJson(path, required = true) {
  if (!path) {
    if (required) fail('required JSON path missing')
    return null
  }
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'))
  } catch (error) {
    if (required) throw error
    return null
  }
}
async function writeJson(path, value) {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}
function addBlocker(blockers, condition, code, detail) {
  if (!condition) blockers.push({ code, detail })
}
function finiteNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0
}
function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
if (!options.output) fail('--output is required')

const stableGuard = await readJson(STABLE_GUARD_PATH)
const terminalVerify = await readJson(options['terminal-verify'])
const databaseGuardExitCode = Number(options['database-guard-exit'] ?? '0')
if (!Number.isSafeInteger(databaseGuardExitCode) || databaseGuardExitCode < 0) fail('invalid --database-guard-exit')
const databaseGuard = await readJson(options['database-guard'], false)
const capacityQualification = await readJson(options['capacity-qualification'], false)

const blockers = []
addBlocker(blockers, terminalVerify?.passed === true, 'terminal_certificate_verify_failed', 'independent terminal certificate/archive verification did not pass')
addBlocker(blockers, terminalVerify?.productionDatabaseReadOnly === true, 'terminal_verify_not_read_only', 'terminal verification was not marked read-only')
addBlocker(blockers, terminalVerify?.sourceCommit === sourceCommit, 'terminal_verify_source_commit_mismatch', 'terminal verification source commit differs from current main')
addBlocker(blockers, terminalVerify?.executionCommit === stableGuard.executionCommit, 'terminal_execution_commit_mismatch', 'terminal verification execution commit differs from reviewed stable guard')
addBlocker(blockers, terminalVerify?.atomicBundleSha256 === stableGuard.bundleSha256, 'terminal_bundle_mismatch', 'terminal verification bundle differs from reviewed stable guard')
addBlocker(blockers, terminalVerify?.r5RearmAuthorized === false, 'terminal_verify_rearm_boundary_drift', 'terminal verification unexpectedly authorizes rearm')
addBlocker(blockers, terminalVerify?.mainnetEnabled === false, 'terminal_verify_mainnet_boundary_drift', 'terminal verification unexpectedly enables Mainnet')

addBlocker(blockers, databaseGuardExitCode === 0, 'database_guard_verify_failed', `database guard verifier exit code ${databaseGuardExitCode}`)
if (databaseGuard) {
  addBlocker(blockers, databaseGuard.sourceCommit === sourceCommit, 'database_guard_source_commit_mismatch', 'database guard verification source commit differs from current main')
  addBlocker(blockers, databaseGuard.guardInstalled === true, 'database_guard_not_installed', 'database claim guard is not verified installed')
  addBlocker(blockers, databaseGuard.productionDatabaseReadOnly === true, 'database_guard_verify_not_read_only', 'database guard verification was not marked read-only')
  addBlocker(blockers, databaseGuard.naturalDatabaseHaltObserved === true, 'database_halt_not_observed', 'expected natural database halt was not verified')
  addBlocker(blockers, databaseGuard.manualClaimInvoked === false, 'manual_claim_detected', 'database guard verification indicates a manual claim')
  addBlocker(blockers, databaseGuard.run?.runId === ACTIVE_RUN_ID, 'active_run_identity_mismatch', 'active revision-4 minute successor identity differs')
  addBlocker(blockers, databaseGuard.run?.status === 'halted', 'active_run_not_halted', `active run status is ${String(databaseGuard.run?.status)}`)
  addBlocker(blockers, databaseGuard.run?.lastError === 'r5_recovery_database_halt', 'active_run_halt_reason_mismatch', `active run last error is ${String(databaseGuard.run?.lastError)}`)
  addBlocker(blockers, Number(databaseGuard.batchCounts?.leased ?? -1) === 0, 'active_lease_present', `leased batch count is ${String(databaseGuard.batchCounts?.leased)}`)
  addBlocker(blockers, Number(databaseGuard.scheduler?.count ?? -1) === 1, 'minute_scheduler_count_mismatch', `minute scheduler count is ${String(databaseGuard.scheduler?.count)}`)
  addBlocker(blockers, databaseGuard.scheduler?.schedule === '* * * * *', 'minute_scheduler_schedule_mismatch', `minute scheduler schedule is ${String(databaseGuard.scheduler?.schedule)}`)
  addBlocker(blockers, databaseGuard.scheduler?.active === true, 'minute_scheduler_inactive', 'minute scheduler is not active')
  addBlocker(blockers, Number(databaseGuard.databaseBytes) < DATABASE_HALT_BYTES, 'database_headroom_not_positive', `database bytes ${String(databaseGuard.databaseBytes)} are not below ${DATABASE_HALT_BYTES}`)
  addBlocker(blockers, Number(databaseGuard.databaseHeadroomBytes) > 0, 'database_headroom_not_positive', `database headroom is ${String(databaseGuard.databaseHeadroomBytes)}`)
  addBlocker(blockers, databaseGuard.schedulerMutationPerformed === false, 'scheduler_mutation_boundary_drift', 'readiness evidence indicates scheduler mutation')
  addBlocker(blockers, databaseGuard.deploymentPerformed === false, 'deployment_boundary_drift', 'readiness evidence indicates deployment')
  addBlocker(blockers, databaseGuard.publicReaderMutationPerformed === false, 'public_reader_boundary_drift', 'readiness evidence indicates public-reader mutation')
  addBlocker(blockers, databaseGuard.rearmAuthorized === false, 'rearm_boundary_drift', 'database guard evidence unexpectedly authorizes rearm')
  addBlocker(blockers, databaseGuard.mainnetDisabled === true, 'mainnet_boundary_drift', 'database guard evidence does not keep Mainnet disabled')
} else {
  blockers.push({ code: 'database_guard_evidence_missing', detail: 'database guard verifier produced no readable evidence' })
}

if (!capacityQualification) {
  blockers.push({
    code: 'capacity_qualification_missing',
    detail: 'no independently reviewed post-reclaim growth/capacity qualification was supplied; positive 400MB headroom alone is not sufficient for R5 rearm candidacy',
  })
} else {
  const growth = capacityQualification.growthModel ?? {}
  const resource = capacityQualification.resourceBounds ?? {}
  const projectedIncrementalRows = Number(growth.projectedIncrementalRows)
  const reserveWindows = Number(growth.reserveWindows)
  const requiredReserveRows = Number(growth.requiredReserveRows)
  const remainingCapacityRows = Number(capacityQualification.conservativeRemainingCapacityRows)
  const projectedDatabaseBytesReserve = Number(capacityQualification.projectedDatabaseBytesReserve)
  const projectedEgress31dBytes = Number(resource.projectedEgress31dBytes)
  const memoryUpperBytes = Number(resource.memoryUpperBytes)
  const projectedInvocations31d = Number(resource.projectedInvocations31d)

  addBlocker(blockers, Number(capacityQualification.schemaVersion) >= 2, 'capacity_qualification_schema_too_old', `capacity qualification schema is ${String(capacityQualification.schemaVersion)}`)
  addBlocker(blockers, capacityQualification.purpose === CAPACITY_QUALIFICATION_PURPOSE, 'capacity_qualification_purpose_mismatch', `capacity qualification purpose is ${String(capacityQualification.purpose)}`)
  addBlocker(blockers, capacityQualification.sourceCommit === sourceCommit, 'capacity_qualification_source_commit_mismatch', 'capacity qualification source commit differs from current main')
  addBlocker(blockers, capacityQualification.productionDatabaseReadOnly === true, 'capacity_qualification_not_read_only', 'capacity qualification was not marked read-only')
  addBlocker(blockers, capacityQualification.bsrReadExecuted === true, 'capacity_qualification_bsr_read_missing', 'capacity qualification did not execute its bounded-state read')
  addBlocker(blockers, capacityQualification.rowMutationPerformed === false, 'capacity_qualification_row_mutation', 'capacity qualification indicates row mutation')
  addBlocker(blockers, capacityQualification.schedulerMutationPerformed === false, 'capacity_qualification_scheduler_mutation', 'capacity qualification indicates scheduler mutation')
  addBlocker(blockers, capacityQualification.deploymentPerformed === false, 'capacity_qualification_deployment', 'capacity qualification indicates deployment')
  addBlocker(blockers, capacityQualification.publicReaderMutationPerformed === false, 'capacity_qualification_public_reader_mutation', 'capacity qualification indicates public-reader mutation')
  addBlocker(blockers, capacityQualification.migrationMutationPerformed === false, 'capacity_qualification_migration_mutation', 'capacity qualification indicates migration mutation')
  addBlocker(blockers, capacityQualification.r5RearmPerformed === false, 'capacity_qualification_rearm_performed', 'capacity qualification indicates R5 rearm')
  addBlocker(blockers, capacityQualification.currentSpecificationIntact === true, 'capacity_qualification_spec_weakened', 'capacity qualification does not prove the current product specification remained intact')
  addBlocker(blockers, capacityQualification.integrityPreservingReclaimOrRetentionProven === true, 'capacity_reclaim_not_proven', 'bounded integrity-preserving reclaim/retention proof is absent')
  addBlocker(blockers, capacityQualification.postReclaimCapacityRemeasured === true, 'post_reclaim_capacity_not_remeasured', 'post-reclaim production capacity was not independently remeasured')
  addBlocker(blockers, capacityQualification.growthRemeasured === true, 'post_reclaim_growth_not_remeasured', 'post-reclaim database growth was not independently remeasured')

  addBlocker(blockers, finitePositive(projectedIncrementalRows), 'capacity_projected_rows_invalid', `projected incremental rows are ${String(growth.projectedIncrementalRows)}`)
  addBlocker(blockers, Number.isSafeInteger(reserveWindows) && reserveWindows >= MIN_CAPACITY_RESERVE_WINDOWS, 'capacity_reserve_window_too_small', `reserve windows are ${String(growth.reserveWindows)}`)
  addBlocker(blockers, Number.isSafeInteger(requiredReserveRows) && requiredReserveRows === projectedIncrementalRows * reserveWindows, 'capacity_required_reserve_rows_mismatch', `required reserve rows ${String(growth.requiredReserveRows)} do not match projected rows x windows`)
  addBlocker(blockers, Number.isSafeInteger(remainingCapacityRows) && remainingCapacityRows > requiredReserveRows, 'capacity_remaining_rows_insufficient', `remaining capacity rows ${String(capacityQualification.conservativeRemainingCapacityRows)} are not above required reserve ${String(growth.requiredReserveRows)}`)
  addBlocker(blockers, finiteNonNegative(projectedDatabaseBytesReserve) && projectedDatabaseBytesReserve < DATABASE_HALT_BYTES, 'capacity_projected_database_reserve_unsafe', `projected reserve database bytes are ${String(capacityQualification.projectedDatabaseBytesReserve)}`)
  addBlocker(blockers, capacityQualification.databaseCapacitySafe === true, 'capacity_database_boolean_mismatch', 'capacity qualification did not compute database capacity as safe')

  addBlocker(blockers, Number(resource.projectEgressHalt31dBytes) === PROJECT_EGRESS_HALT_31D_BYTES, 'capacity_egress_halt_boundary_mismatch', `egress halt is ${String(resource.projectEgressHalt31dBytes)}`)
  addBlocker(blockers, finiteNonNegative(projectedEgress31dBytes) && projectedEgress31dBytes < PROJECT_EGRESS_HALT_31D_BYTES, 'capacity_projected_egress_unsafe', `projected 31d egress is ${String(resource.projectedEgress31dBytes)}`)
  addBlocker(blockers, resource.egressCapacitySafe === true, 'capacity_egress_boolean_mismatch', 'capacity qualification did not compute egress capacity as safe')
  addBlocker(blockers, Number(resource.projectMemoryHaltBytes) === PROJECT_MEMORY_HALT_BYTES, 'capacity_memory_halt_boundary_mismatch', `memory halt is ${String(resource.projectMemoryHaltBytes)}`)
  addBlocker(blockers, finiteNonNegative(memoryUpperBytes) && memoryUpperBytes < PROJECT_MEMORY_HALT_BYTES, 'capacity_projected_memory_unsafe', `memory upper bound is ${String(resource.memoryUpperBytes)}`)
  addBlocker(blockers, resource.memoryCapacitySafe === true, 'capacity_memory_boolean_mismatch', 'capacity qualification did not compute memory capacity as safe')
  addBlocker(blockers, Number(resource.projectInvocationHalt31d) === PROJECT_INVOCATION_HALT_31D, 'capacity_invocation_halt_boundary_mismatch', `invocation halt is ${String(resource.projectInvocationHalt31d)}`)
  addBlocker(blockers, finiteNonNegative(projectedInvocations31d) && projectedInvocations31d < PROJECT_INVOCATION_HALT_31D, 'capacity_projected_invocations_unsafe', `projected 31d invocations are ${String(resource.projectedInvocations31d)}`)
  addBlocker(blockers, resource.invocationCapacitySafe === true, 'capacity_invocation_boolean_mismatch', 'capacity qualification did not compute invocation capacity as safe')

  const recomputedSafe = capacityQualification.currentSpecificationIntact === true
    && capacityQualification.integrityPreservingReclaimOrRetentionProven === true
    && capacityQualification.databaseCapacitySafe === true
    && resource.egressCapacitySafe === true
    && resource.memoryCapacitySafe === true
    && resource.invocationCapacitySafe === true
    && remainingCapacityRows > requiredReserveRows
    && projectedDatabaseBytesReserve < DATABASE_HALT_BYTES
    && projectedEgress31dBytes < PROJECT_EGRESS_HALT_31D_BYTES
    && memoryUpperBytes < PROJECT_MEMORY_HALT_BYTES
    && projectedInvocations31d < PROJECT_INVOCATION_HALT_31D
  addBlocker(blockers, capacityQualification.sustainedFreeOperationCapacityProblemClosed === recomputedSafe, 'free_operation_capacity_boolean_mismatch', 'capacity closure boolean does not match numeric recomputation')
  addBlocker(blockers, capacityQualification.safeForR5Rearm === recomputedSafe, 'capacity_qualification_rearm_boolean_mismatch', 'safe-for-rearm boolean does not match numeric recomputation')
  addBlocker(blockers, recomputedSafe === true, 'free_operation_capacity_problem_open', 'numeric capacity qualification does not close the sustained free-operation capacity problem')
  addBlocker(blockers, capacityQualification.r5RearmAuthorized === false, 'capacity_qualification_authorization_boundary_drift', 'capacity qualification unexpectedly authorizes rearm')
  addBlocker(blockers, capacityQualification.mainnetEnabled === false, 'capacity_qualification_mainnet_boundary_drift', 'capacity qualification unexpectedly enables Mainnet')
  if (databaseGuard) {
    addBlocker(blockers, Number(capacityQualification.databaseHaltBytes) === DATABASE_HALT_BYTES, 'capacity_qualification_halt_boundary_mismatch', `capacity qualification halt boundary is ${String(capacityQualification.databaseHaltBytes)}`)
    addBlocker(blockers, Number(capacityQualification.databaseBytes) === Number(databaseGuard.databaseBytes), 'capacity_qualification_database_state_stale', `capacity qualification database bytes ${String(capacityQualification.databaseBytes)} differ from current read-only database guard observation ${String(databaseGuard.databaseBytes)}`)
    addBlocker(blockers, Number(capacityQualification.databaseHeadroomBytes) === Number(databaseGuard.databaseHeadroomBytes), 'capacity_qualification_headroom_state_stale', `capacity qualification headroom ${String(capacityQualification.databaseHeadroomBytes)} differ from current read-only database guard observation ${String(databaseGuard.databaseHeadroomBytes)}`)
  }
}

const uniqueBlockers = [...new Map(blockers.map((entry) => [entry.code, entry])).values()]
const evidence = {
  schemaVersion: 3,
  purpose: 'r5-post-terminal-apply-readonly-rearm-readiness',
  sourceCommit,
  stableGuardId: stableGuard.guardId,
  reviewedExecutionCommit: stableGuard.executionCommit,
  reviewedAtomicBundleSha256: stableGuard.bundleSha256,
  capacityQualificationRequired: true,
  capacityQualificationPurpose: CAPACITY_QUALIFICATION_PURPOSE,
  candidateForSeparateRearmAuthorization: uniqueBlockers.length === 0,
  blockerCount: uniqueBlockers.length,
  blockers: uniqueBlockers,
  observed: {
    terminalVerificationPassed: terminalVerify?.passed === true,
    databaseGuardVerifierExitCode: databaseGuardExitCode,
    databaseBytes: databaseGuard?.databaseBytes ?? null,
    databaseHaltBytes: DATABASE_HALT_BYTES,
    databaseHeadroomBytes: databaseGuard?.databaseHeadroomBytes ?? null,
    capacityQualificationSupplied: Boolean(capacityQualification),
    capacityQualificationSafeForR5Rearm: capacityQualification?.safeForR5Rearm ?? null,
    capacityProjectedIncrementalRows: capacityQualification?.growthModel?.projectedIncrementalRows ?? null,
    capacityRequiredReserveRows: capacityQualification?.growthModel?.requiredReserveRows ?? null,
    capacityRemainingRows: capacityQualification?.conservativeRemainingCapacityRows ?? null,
    capacityProjectedDatabaseBytesReserve: capacityQualification?.projectedDatabaseBytesReserve ?? null,
    activeRunId: databaseGuard?.run?.runId ?? null,
    activeRunStatus: databaseGuard?.run?.status ?? null,
    activeRunLastError: databaseGuard?.run?.lastError ?? null,
    leasedBatchCount: databaseGuard?.batchCounts?.leased ?? null,
    minuteSchedulerCount: databaseGuard?.scheduler?.count ?? null,
    minuteSchedulerSchedule: databaseGuard?.scheduler?.schedule ?? null,
    minuteSchedulerActive: databaseGuard?.scheduler?.active ?? null,
  },
  productionDatabaseReadOnly: true,
  productionMutationAuthorized: false,
  schedulerMutationAuthorized: false,
  deploymentAuthorized: false,
  publicReaderMutationAuthorized: false,
  archiveDeleteOrStopAuthorized: false,
  r5RearmAuthorized: false,
  r5RestartPerformed: false,
  mainnetEnabled: false,
  stabilizationAuthorized: false,
  soakAuthorized: false,
  checkedAt: new Date().toISOString(),
}

await writeJson(options.output, evidence)
process.stdout.write(`${JSON.stringify(evidence)}\n`)
