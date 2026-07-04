export type VerificationState = 'observed' | 'missing' | 'inconsistent'

export interface LiveContinuationEvidence {
  cursor: {
    epochId: string | null
    lastProcessedLedger: number | null
    lastProcessedHash: string | null
    latestObservedLedger: number | null
    latestObservedHash: string | null
  }
  overlay: {
    epochId: string | null
    overlayLedgerIndex: number | null
    overlayLedgerHash: string | null
  }
  collector: {
    status: string | null
    lagLedgers: number | null
    lastSuccessAt: string | null
  }
  processedLedgers: {
    count: number
    minimum: number | null
    maximum: number | null
  }
  objectChanges: {
    created: number
    modified: number
    deleted: number
  }
  overlayObjects: {
    upserts: number
    tombstones: number
  }
  protocolEvents: {
    total: number
    loanPay: number
    loanManage: number
  }
  lifecycle: {
    payment: number
    paid: number
    impaired: number
    unimpaired: number
    defaulted: number
    deleted: number
  }
  archives: {
    total: number
    missingTombstones: number
    tombstonesMissingArchive: number
  }
  balanceHistory: {
    total: number
  }
}

export interface VerificationPath {
  state: VerificationState
  reason: string
}

export interface LiveContinuationVerificationReport {
  passed: boolean
  paths: {
    createdCurrent: VerificationPath
    modifiedCurrent: VerificationPath
    loanPayment: VerificationPath
    impaired: VerificationPath
    unimpaired: VerificationPath
    defaulted: VerificationPath
    deletionArchive: VerificationPath
    activityHistoryBalance: VerificationPath
    cursorOverlay: VerificationPath
    freshness: VerificationPath
  }
}

function countPair(
  source: number,
  projection: number,
  missingReason: string,
  inconsistentReason: string,
): VerificationPath {
  if (source === 0 && projection === 0) return { state: 'missing', reason: missingReason }
  if (source === 0 || projection === 0) return { state: 'inconsistent', reason: inconsistentReason }
  return { state: 'observed', reason: 'matching live evidence observed' }
}

function lifecyclePath(count: number, label: string): VerificationPath {
  return count > 0
    ? { state: 'observed', reason: `${label} lifecycle evidence observed` }
    : { state: 'missing', reason: `${label} lifecycle evidence not yet observed` }
}

export function evaluateLiveContinuationEvidence(
  evidence: LiveContinuationEvidence,
): LiveContinuationVerificationReport {
  const createdCurrent = countPair(
    evidence.objectChanges.created,
    evidence.overlayObjects.upserts,
    'no created-object continuation evidence observed',
    'created-object and current-overlay evidence disagree',
  )
  const modifiedCurrent = countPair(
    evidence.objectChanges.modified,
    evidence.overlayObjects.upserts,
    'no modified-object continuation evidence observed',
    'modified-object and current-overlay evidence disagree',
  )

  const paymentLifecycle = evidence.lifecycle.payment + evidence.lifecycle.paid
  const loanPayment = countPair(
    evidence.protocolEvents.loanPay,
    paymentLifecycle,
    'no LoanPay continuation evidence observed',
    'LoanPay activity and lifecycle evidence disagree',
  )

  const impaired = lifecyclePath(evidence.lifecycle.impaired, 'impaired')
  const unimpaired = lifecyclePath(evidence.lifecycle.unimpaired, 'unimpaired')
  const defaulted = lifecyclePath(evidence.lifecycle.defaulted, 'defaulted')

  let deletionArchive: VerificationPath
  if (
    evidence.objectChanges.deleted === 0
    && evidence.archives.total === 0
    && evidence.overlayObjects.tombstones === 0
  ) {
    deletionArchive = {
      state: 'missing',
      reason: 'no deletion, archive, or tombstone continuation evidence observed',
    }
  } else if (
    evidence.objectChanges.deleted === 0
    || evidence.archives.total === 0
    || evidence.overlayObjects.tombstones === 0
    || evidence.archives.missingTombstones > 0
    || evidence.archives.tombstonesMissingArchive > 0
  ) {
    deletionArchive = {
      state: 'inconsistent',
      reason: 'deletion, archive, and tombstone evidence disagree',
    }
  } else {
    deletionArchive = {
      state: 'observed',
      reason: 'deletion, archive, and tombstone evidence agree',
    }
  }

  let activityHistoryBalance: VerificationPath
  if (
    evidence.protocolEvents.total === 0
    && paymentLifecycle === 0
    && evidence.balanceHistory.total === 0
  ) {
    activityHistoryBalance = {
      state: 'missing',
      reason: 'activity, lifecycle, and balance-history evidence not yet observed',
    }
  } else if (
    evidence.protocolEvents.total === 0
    || paymentLifecycle === 0
    || evidence.balanceHistory.total === 0
  ) {
    activityHistoryBalance = {
      state: 'inconsistent',
      reason: 'activity, lifecycle, and balance-history evidence are incomplete',
    }
  } else {
    activityHistoryBalance = {
      state: 'observed',
      reason: 'activity, lifecycle, and balance-history evidence observed',
    }
  }

  let cursorOverlay: VerificationPath
  if (
    evidence.cursor.epochId === null
    || evidence.cursor.lastProcessedLedger === null
    || evidence.cursor.lastProcessedHash === null
    || evidence.overlay.epochId === null
    || evidence.overlay.overlayLedgerIndex === null
    || evidence.overlay.overlayLedgerHash === null
  ) {
    cursorOverlay = {
      state: 'missing',
      reason: 'cursor or overlay watermark is unavailable',
    }
  } else if (
    evidence.cursor.epochId !== evidence.overlay.epochId
    || evidence.cursor.lastProcessedLedger !== evidence.overlay.overlayLedgerIndex
    || evidence.cursor.lastProcessedHash !== evidence.overlay.overlayLedgerHash
  ) {
    cursorOverlay = {
      state: 'inconsistent',
      reason: 'cursor and overlay watermark disagree',
    }
  } else {
    cursorOverlay = {
      state: 'observed',
      reason: 'cursor and overlay watermark agree',
    }
  }

  let freshness: VerificationPath
  if (!evidence.collector.status || evidence.collector.lastSuccessAt === null) {
    freshness = { state: 'missing', reason: 'collector freshness evidence unavailable' }
  } else if (
    evidence.collector.status === 'error'
    || evidence.collector.status === 'stale'
    || evidence.collector.status === 'reset_suspected'
  ) {
    freshness = { state: 'inconsistent', reason: `collector status is ${evidence.collector.status}` }
  } else if (
    evidence.collector.status !== 'healthy'
    || evidence.collector.lagLedgers === null
    || evidence.collector.lagLedgers !== 0
  ) {
    freshness = { state: 'missing', reason: 'collector has not yet reached a verified fresh head' }
  } else {
    freshness = { state: 'observed', reason: 'collector is healthy at zero reported lag' }
  }

  const paths = {
    createdCurrent,
    modifiedCurrent,
    loanPayment,
    impaired,
    unimpaired,
    defaulted,
    deletionArchive,
    activityHistoryBalance,
    cursorOverlay,
    freshness,
  }

  return {
    passed: Object.values(paths).every((path) => path.state === 'observed'),
    paths,
  }
}
