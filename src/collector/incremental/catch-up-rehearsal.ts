import type { ReconciliationIssue } from './reconciliation'

export interface RehearsalCheckpoint {
  phase: 'commit' | 'interrupt' | 'resume' | 'replay' | 'gap_rejected'
  rangeStart: number | null
  rangeEnd: number | null
  cursorLedger: number
  cursorHash: string
  overlayLedger: number
  overlayHash: string
}

export interface RehearsalCounts {
  vaults: number
  loanBrokers: number
  loans: number
}

export interface RehearsalCountDeltas {
  created: RehearsalCounts
  deletedFromBase: RehearsalCounts
}

export interface CatchUpRehearsalReport {
  passed: boolean
  issues: string[]
  finalCursorLedger: number
  expectedCounts: RehearsalCounts
}

function applyDeltas(base: RehearsalCounts, deltas: RehearsalCountDeltas): RehearsalCounts {
  return {
    vaults: base.vaults + deltas.created.vaults - deltas.deletedFromBase.vaults,
    loanBrokers: base.loanBrokers
      + deltas.created.loanBrokers
      - deltas.deletedFromBase.loanBrokers,
    loans: base.loans + deltas.created.loans - deltas.deletedFromBase.loans,
  }
}

export function evaluateCatchUpRehearsal(options: {
  baseLedger: number
  validatedHead: number
  checkpoints: readonly RehearsalCheckpoint[]
  baseCounts: RehearsalCounts
  countDeltas: RehearsalCountDeltas
  resolvedCounts: RehearsalCounts
  relationshipIssues: readonly ReconciliationIssue[]
  deletedObjectIds: readonly string[]
  currentObjectIds: readonly string[]
  archivedObjectIds: readonly string[]
}): CatchUpRehearsalReport {
  const issues: string[] = []
  let priorCursor = options.baseLedger
  let priorHash: string | null = null

  for (const checkpoint of options.checkpoints) {
    if (
      checkpoint.cursorLedger !== checkpoint.overlayLedger
      || checkpoint.cursorHash !== checkpoint.overlayHash
    ) {
      issues.push(`cursor_overlay_divergence:${checkpoint.phase}:${checkpoint.cursorLedger}`)
    }

    if (checkpoint.phase === 'commit' || checkpoint.phase === 'resume') {
      if (checkpoint.rangeStart !== priorCursor + 1) {
        issues.push(`non_contiguous_start:${checkpoint.phase}:${checkpoint.rangeStart}`)
      }
      if (checkpoint.rangeEnd === null || checkpoint.cursorLedger !== checkpoint.rangeEnd) {
        issues.push(`cursor_not_at_range_end:${checkpoint.phase}:${checkpoint.cursorLedger}`)
      }
      if (checkpoint.cursorLedger < priorCursor) {
        issues.push(`cursor_regression:${checkpoint.phase}:${checkpoint.cursorLedger}`)
      }
      priorCursor = checkpoint.cursorLedger
      priorHash = checkpoint.cursorHash
      continue
    }

    if (checkpoint.phase === 'interrupt' || checkpoint.phase === 'gap_rejected') {
      if (checkpoint.cursorLedger !== priorCursor) {
        issues.push(`cursor_moved_on_${checkpoint.phase}:${checkpoint.cursorLedger}`)
      }
      continue
    }

    if (checkpoint.phase === 'replay') {
      if (checkpoint.cursorLedger !== priorCursor) {
        issues.push(`cursor_moved_on_replay:${checkpoint.cursorLedger}`)
      }
      if (checkpoint.rangeEnd !== null && checkpoint.rangeEnd > priorCursor) {
        issues.push(`replay_exceeds_cursor:${checkpoint.rangeEnd}`)
      }
    }
  }

  if (priorCursor !== options.validatedHead) {
    issues.push(`head_not_reached:${priorCursor}:${options.validatedHead}`)
  }
  if (priorHash === null && options.validatedHead > options.baseLedger) {
    issues.push('missing_final_cursor_hash')
  }

  const expectedCounts = applyDeltas(options.baseCounts, options.countDeltas)
  if (
    expectedCounts.vaults !== options.resolvedCounts.vaults
    || expectedCounts.loanBrokers !== options.resolvedCounts.loanBrokers
    || expectedCounts.loans !== options.resolvedCounts.loans
  ) {
    issues.push('count_reconciliation_failed')
  }

  for (const issue of options.relationshipIssues) {
    issues.push(`relationship:${issue.type}:${issue.objectId}:${issue.relatedId}`)
  }

  const currentIds = new Set(options.currentObjectIds)
  const archivedIds = new Set(options.archivedObjectIds)
  for (const objectId of options.deletedObjectIds) {
    if (currentIds.has(objectId)) issues.push(`deleted_object_still_current:${objectId}`)
    if (!archivedIds.has(objectId)) issues.push(`deleted_object_missing_archive:${objectId}`)
  }

  return {
    passed: issues.length === 0,
    issues,
    finalCursorLedger: priorCursor,
    expectedCounts,
  }
}
