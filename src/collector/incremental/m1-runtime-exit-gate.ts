import type { LiveContinuationVerificationReport, VerificationPath } from './live-continuation-verification'

export interface M1RuntimeExitEvidence {
  expectedBase: {
    epochId: string | null
    snapshotId: string | null
    ledgerIndex: number | null
    ledgerHash: string | null
  }
  boundBase: {
    epochId: string | null
    snapshotId: string | null
    ledgerIndex: number | null
    ledgerHash: string | null
  }
  processedLedgers: {
    count: number
    minimum: number | null
    maximum: number | null
  }
  cursor: {
    lastProcessedLedger: number | null
    lastProcessedHash: string | null
    latestObservedLedger: number | null
    latestObservedHash: string | null
  }
  continuation: LiveContinuationVerificationReport
}

export interface M1RuntimeExitReport {
  ready: boolean
  gates: {
    verifiedBaseBinding: VerificationPath
    catchUpStart: VerificationPath
    validatedHeadReached: VerificationPath
    liveContinuation: VerificationPath
  }
  continuationPaths: LiveContinuationVerificationReport['paths']
}

export function evaluateM1RuntimeExit(
  evidence: M1RuntimeExitEvidence,
): M1RuntimeExitReport {
  const expectedBaseAvailable = evidence.expectedBase.epochId !== null
    && evidence.expectedBase.snapshotId !== null
    && evidence.expectedBase.ledgerIndex !== null
    && evidence.expectedBase.ledgerHash !== null
  const boundBaseAvailable = evidence.boundBase.epochId !== null
    && evidence.boundBase.snapshotId !== null
    && evidence.boundBase.ledgerIndex !== null
    && evidence.boundBase.ledgerHash !== null
  const baseMatches = expectedBaseAvailable
    && boundBaseAvailable
    && evidence.boundBase.epochId === evidence.expectedBase.epochId
    && evidence.boundBase.snapshotId === evidence.expectedBase.snapshotId
    && evidence.boundBase.ledgerIndex === evidence.expectedBase.ledgerIndex
    && evidence.boundBase.ledgerHash === evidence.expectedBase.ledgerHash

  const verifiedBaseBinding: VerificationPath = !expectedBaseAvailable || !boundBaseAvailable
    ? { state: 'missing', reason: 'verified base source or active overlay binding is unavailable' }
    : baseMatches
      ? { state: 'observed', reason: 'active overlay is bound to the expected verified base' }
      : { state: 'inconsistent', reason: 'active overlay base identity differs from the expected verified base' }

  let catchUpStart: VerificationPath
  if (evidence.expectedBase.ledgerIndex === null) {
    catchUpStart = { state: 'missing', reason: 'verified base ledger is unavailable' }
  } else if (evidence.processedLedgers.count === 0 || evidence.processedLedgers.minimum === null) {
    catchUpStart = { state: 'missing', reason: 'production catch-up has not produced processed-ledger evidence' }
  } else if (evidence.processedLedgers.minimum !== evidence.expectedBase.ledgerIndex + 1) {
    catchUpStart = {
      state: 'inconsistent',
      reason: 'processed-ledger evidence does not begin at verified base ledger plus one',
    }
  } else {
    catchUpStart = {
      state: 'observed',
      reason: 'processed-ledger evidence begins at verified base ledger plus one',
    }
  }

  let validatedHeadReached: VerificationPath
  const cursor = evidence.cursor
  if (
    cursor.lastProcessedLedger === null
    || cursor.lastProcessedHash === null
    || cursor.latestObservedLedger === null
    || cursor.latestObservedHash === null
  ) {
    validatedHeadReached = { state: 'missing', reason: 'cursor or validated-head evidence is unavailable' }
  } else if (cursor.lastProcessedLedger > cursor.latestObservedLedger) {
    validatedHeadReached = { state: 'inconsistent', reason: 'collector cursor is ahead of the observed validated head' }
  } else if (
    cursor.lastProcessedLedger === cursor.latestObservedLedger
    && cursor.lastProcessedHash !== cursor.latestObservedHash
  ) {
    validatedHeadReached = { state: 'inconsistent', reason: 'cursor and validated head disagree at the same ledger index' }
  } else if (cursor.lastProcessedLedger < cursor.latestObservedLedger) {
    validatedHeadReached = { state: 'missing', reason: 'collector has not yet reached the observed validated head' }
  } else {
    validatedHeadReached = { state: 'observed', reason: 'collector cursor matches the observed validated head' }
  }

  const continuationStates = Object.values(evidence.continuation.paths).map((path) => path.state)
  const liveContinuation: VerificationPath = evidence.continuation.passed
    ? { state: 'observed', reason: 'all required live continuation paths are observed and consistent' }
    : continuationStates.includes('inconsistent')
      ? { state: 'inconsistent', reason: 'one or more live continuation paths are inconsistent' }
      : { state: 'missing', reason: 'one or more required live continuation paths are not yet observed' }

  const gates = {
    verifiedBaseBinding,
    catchUpStart,
    validatedHeadReached,
    liveContinuation,
  }

  return {
    ready: Object.values(gates).every((gate) => gate.state === 'observed'),
    gates,
    continuationPaths: evidence.continuation.paths,
  }
}
