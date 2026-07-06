export const MAX_HISTORY_BACKFILL_SEGMENT_LEDGERS = 500

export interface HistoryBackfillSegmentPlan {
  ordinal: number
  segmentId: string
  startLedgerIndex: number
  endLedgerIndex: number
  ledgerCount: number
  checkpointAfter: boolean
}

export interface HistoryBackfillPlan {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  startLedgerIndex: number
  endLedgerIndex: number
  ledgerCount: number
  segmentLedgerLimit: number
  checkpointEverySegments: number
  segmentCount: number
  checkpointCount: number
  segments: HistoryBackfillSegmentPlan[]
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function safeEpochId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error('epochId must be a flat safe identifier')
  }
}

export function assertHistoryBackfillPlan(plan: HistoryBackfillPlan): void {
  if (plan.schemaVersion !== 1 || plan.network !== 'devnet') {
    throw new Error('History backfill plan schema is invalid')
  }
  safeEpochId(plan.epochId)
  positiveInteger(plan.startLedgerIndex, 'startLedgerIndex')
  positiveInteger(plan.endLedgerIndex, 'endLedgerIndex')
  positiveInteger(plan.ledgerCount, 'ledgerCount')
  positiveInteger(plan.segmentLedgerLimit, 'segmentLedgerLimit')
  positiveInteger(plan.checkpointEverySegments, 'checkpointEverySegments')
  positiveInteger(plan.segmentCount, 'segmentCount')
  positiveInteger(plan.checkpointCount, 'checkpointCount')
  if (plan.endLedgerIndex < plan.startLedgerIndex) throw new Error('History backfill plan range is inverted')
  if (plan.segmentLedgerLimit > MAX_HISTORY_BACKFILL_SEGMENT_LEDGERS) {
    throw new Error('History backfill segment limit exceeds runner maximum')
  }
  if (plan.ledgerCount !== plan.endLedgerIndex - plan.startLedgerIndex + 1) {
    throw new Error('History backfill plan ledger count mismatch')
  }
  if (plan.segments.length !== plan.segmentCount) {
    throw new Error('History backfill segment count mismatch')
  }

  let expectedStart = plan.startLedgerIndex
  let totalLedgers = 0
  let checkpointCount = 0
  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index]!
    if (segment.ordinal !== index + 1) throw new Error('History backfill segment ordinal mismatch')
    if (segment.startLedgerIndex !== expectedStart) {
      throw new Error('History backfill segment coverage has a gap or overlap')
    }
    if (segment.endLedgerIndex < segment.startLedgerIndex) {
      throw new Error('History backfill segment range is inverted')
    }
    if (segment.ledgerCount !== segment.endLedgerIndex - segment.startLedgerIndex + 1) {
      throw new Error('History backfill segment ledger count mismatch')
    }
    if (segment.ledgerCount > plan.segmentLedgerLimit) {
      throw new Error('History backfill segment exceeds configured ledger limit')
    }
    const expectedId = `${plan.epochId}-${segment.startLedgerIndex}-${segment.endLedgerIndex}`
    if (segment.segmentId !== expectedId) throw new Error('History backfill segment ID mismatch')
    const shouldCheckpoint = (segment.ordinal % plan.checkpointEverySegments === 0)
      || segment.ordinal === plan.segmentCount
    if (segment.checkpointAfter !== shouldCheckpoint) {
      throw new Error('History backfill checkpoint cadence mismatch')
    }
    if (segment.checkpointAfter) checkpointCount += 1
    totalLedgers += segment.ledgerCount
    expectedStart = segment.endLedgerIndex + 1
  }

  if (expectedStart !== plan.endLedgerIndex + 1) {
    throw new Error('History backfill plan does not reach the requested end ledger')
  }
  if (totalLedgers !== plan.ledgerCount) throw new Error('History backfill total coverage mismatch')
  if (checkpointCount !== plan.checkpointCount) throw new Error('History backfill checkpoint count mismatch')
}

export function buildHistoryBackfillPlan(options: {
  epochId: string
  startLedgerIndex: number
  endLedgerIndex: number
  segmentLedgerLimit: number
  checkpointEverySegments: number
}): HistoryBackfillPlan {
  safeEpochId(options.epochId)
  positiveInteger(options.startLedgerIndex, 'startLedgerIndex')
  positiveInteger(options.endLedgerIndex, 'endLedgerIndex')
  positiveInteger(options.segmentLedgerLimit, 'segmentLedgerLimit')
  positiveInteger(options.checkpointEverySegments, 'checkpointEverySegments')
  if (options.endLedgerIndex < options.startLedgerIndex) {
    throw new Error('History backfill range is inverted')
  }
  if (options.segmentLedgerLimit > MAX_HISTORY_BACKFILL_SEGMENT_LEDGERS) {
    throw new Error(`segmentLedgerLimit may not exceed ${MAX_HISTORY_BACKFILL_SEGMENT_LEDGERS}`)
  }

  const segments: HistoryBackfillSegmentPlan[] = []
  for (
    let startLedgerIndex = options.startLedgerIndex;
    startLedgerIndex <= options.endLedgerIndex;
    startLedgerIndex += options.segmentLedgerLimit
  ) {
    const endLedgerIndex = Math.min(
      options.endLedgerIndex,
      startLedgerIndex + options.segmentLedgerLimit - 1,
    )
    const ordinal = segments.length + 1
    segments.push({
      ordinal,
      segmentId: `${options.epochId}-${startLedgerIndex}-${endLedgerIndex}`,
      startLedgerIndex,
      endLedgerIndex,
      ledgerCount: endLedgerIndex - startLedgerIndex + 1,
      checkpointAfter: false,
    })
  }

  for (const segment of segments) {
    segment.checkpointAfter = (segment.ordinal % options.checkpointEverySegments === 0)
      || segment.ordinal === segments.length
  }

  const plan: HistoryBackfillPlan = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: options.epochId,
    startLedgerIndex: options.startLedgerIndex,
    endLedgerIndex: options.endLedgerIndex,
    ledgerCount: options.endLedgerIndex - options.startLedgerIndex + 1,
    segmentLedgerLimit: options.segmentLedgerLimit,
    checkpointEverySegments: options.checkpointEverySegments,
    segmentCount: segments.length,
    checkpointCount: segments.filter((segment) => segment.checkpointAfter).length,
    segments,
  }
  assertHistoryBackfillPlan(plan)
  return plan
}
