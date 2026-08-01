import type {
  BuildNormalizedCollectorPayloadInput,
  NormalizedCandidateV1,
} from './portable-collector-payload'
import type {
  PortableLedgerCostEstimate,
  PortablePlannedScan,
  PortableScanBudget,
} from './portable-collector-planner'
import type { PortableSchedulerFailureClassification } from './portable-collector-scheduler'

export interface PortableFixtureNormalizedRange {
  startLedgerIndex: number
  endLedgerIndex: number
  finalLedgerHash: string
  ledgers: NormalizedCandidateV1[]
  protocolEvents: NormalizedCandidateV1[]
  objectChanges: NormalizedCandidateV1[]
  loanLifecycleEvents: NormalizedCandidateV1[]
  archivedObjects: NormalizedCandidateV1[]
  balanceHistory: NormalizedCandidateV1[]
  currentProjectionMutations: NormalizedCandidateV1[]
}

export type PortableFixtureFailureStage =
  | 'validated_head'
  | 'cost_estimates'
  | 'normalized_range'
  | 'after_scan_staging'
  | 'after_commit_mutation'

export interface PortableFixtureFailure {
  stage: PortableFixtureFailureStage
  classification: Extract<
    PortableSchedulerFailureClassification,
    'retryable_transport' | 'retryable_storage' | 'reset_detected' | 'terminal_internal'
  >
  message: string
  remaining?: number
}

export interface PortableFixtureExecutionOptions {
  network: string
  epochId: string
  baseIdentity: string
  immutableBaseLedgerIndex: number
  immutableBaseLedgerHash: string
  validatedHeadLedgerIndex: number
  budget: PortableScanBudget
  estimates: PortableLedgerCostEstimate[]
  ranges: PortableFixtureNormalizedRange[]
  commitSuccessorAvailableAt: string
  caughtUpSuccessorAvailableAt: string
  retryAvailableAt: string
  failures?: PortableFixtureFailure[]
}

export interface PortableFixtureExecutionCounters {
  validatedHeadReads: number
  estimateReads: number
  normalizedRangeReads: number
  stagedMutationHooks: number
  selectedLedgers: number
  normalizedRecords: number
}

export class PortableFixtureExecutionError extends Error {
  constructor(
    readonly classification: PortableFixtureFailure['classification'],
    message: string,
  ) {
    super(message)
    this.name = 'PortableFixtureExecutionError'
  }
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function requireNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function canonicalHash(value: string, name: string): string {
  return requireNonEmpty(value, name).toUpperCase()
}

function canonicalTimestamp(value: string, name: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be a valid timestamp`)
  return parsed.toISOString()
}

function rangeKey(startLedgerIndex: number, endLedgerIndex: number): string {
  return `${startLedgerIndex}:${endLedgerIndex}`
}

function countRangeRecords(range: PortableFixtureNormalizedRange): number {
  return (
    range.ledgers.length +
    range.protocolEvents.length +
    range.objectChanges.length +
    range.loanLifecycleEvents.length +
    range.archivedObjects.length +
    range.balanceHistory.length +
    range.currentProjectionMutations.length
  )
}

export class FixtureExecutionAdapter {
  readonly network: string
  readonly epochId: string
  readonly baseIdentity: string
  readonly immutableBaseLedgerIndex: number
  readonly immutableBaseLedgerHash: string
  readonly budget: PortableScanBudget
  readonly commitSuccessorAvailableAt: string
  readonly caughtUpSuccessorAvailableAt: string
  readonly retryAvailableAt: string

  private readonly estimates: PortableLedgerCostEstimate[]
  private readonly ranges = new Map<string, PortableFixtureNormalizedRange>()
  private readonly failures: Array<Required<PortableFixtureFailure>>
  private validatedHeadLedgerIndex: number
  private readonly counters: PortableFixtureExecutionCounters = {
    validatedHeadReads: 0,
    estimateReads: 0,
    normalizedRangeReads: 0,
    stagedMutationHooks: 0,
    selectedLedgers: 0,
    normalizedRecords: 0,
  }

  constructor(options: PortableFixtureExecutionOptions) {
    this.network = requireNonEmpty(options.network, 'network')
    this.epochId = requireNonEmpty(options.epochId, 'epochId')
    this.baseIdentity = requireNonEmpty(options.baseIdentity, 'baseIdentity')
    this.immutableBaseLedgerIndex = requireNonNegativeInteger(
      options.immutableBaseLedgerIndex,
      'immutableBaseLedgerIndex',
    )
    this.immutableBaseLedgerHash = canonicalHash(
      options.immutableBaseLedgerHash,
      'immutableBaseLedgerHash',
    )
    this.validatedHeadLedgerIndex = requireNonNegativeInteger(
      options.validatedHeadLedgerIndex,
      'validatedHeadLedgerIndex',
    )
    this.budget = { ...options.budget }
    this.estimates = options.estimates.map((estimate) => ({ ...estimate }))
    this.commitSuccessorAvailableAt = canonicalTimestamp(
      options.commitSuccessorAvailableAt,
      'commitSuccessorAvailableAt',
    )
    this.caughtUpSuccessorAvailableAt = canonicalTimestamp(
      options.caughtUpSuccessorAvailableAt,
      'caughtUpSuccessorAvailableAt',
    )
    this.retryAvailableAt = canonicalTimestamp(options.retryAvailableAt, 'retryAvailableAt')
    this.failures = (options.failures ?? []).map((failure) => ({
      ...failure,
      remaining: failure.remaining ?? 1,
    }))

    for (const range of options.ranges) {
      requireNonNegativeInteger(range.startLedgerIndex, 'range.startLedgerIndex')
      requireNonNegativeInteger(range.endLedgerIndex, 'range.endLedgerIndex')
      if (range.endLedgerIndex < range.startLedgerIndex) {
        throw new Error('fixture range end must not precede its start')
      }
      const key = rangeKey(range.startLedgerIndex, range.endLedgerIndex)
      if (this.ranges.has(key)) throw new Error(`duplicate fixture range: ${key}`)
      this.ranges.set(key, structuredClone(range))
    }
  }

  setValidatedHeadLedgerIndex(ledgerIndex: number): void {
    this.validatedHeadLedgerIndex = requireNonNegativeInteger(
      ledgerIndex,
      'validatedHeadLedgerIndex',
    )
  }

  readValidatedHeadLedgerIndex(): number {
    this.counters.validatedHeadReads += 1
    this.maybeFail('validated_head')
    return this.validatedHeadLedgerIndex
  }

  readLedgerCostEstimates(
    startLedgerIndex: number,
    latestValidatedLedgerIndex: number,
  ): PortableLedgerCostEstimate[] {
    this.counters.estimateReads += 1
    this.maybeFail('cost_estimates')
    return this.estimates
      .filter(
        (estimate) =>
          estimate.ledgerIndex >= startLedgerIndex &&
          estimate.ledgerIndex <= latestValidatedLedgerIndex,
      )
      .map((estimate) => ({ ...estimate }))
  }

  readNormalizedRange(plan: PortablePlannedScan): PortableFixtureNormalizedRange {
    this.counters.normalizedRangeReads += 1
    this.maybeFail('normalized_range')
    const key = rangeKey(plan.startLedgerIndex, plan.endLedgerIndex)
    const range = this.ranges.get(key)
    if (!range) throw new Error(`fixture normalized range not found: ${key}`)
    this.counters.selectedLedgers += plan.selected.length
    this.counters.normalizedRecords += countRangeRecords(range)
    return structuredClone(range)
  }

  buildPayloadInput(
    plan: PortablePlannedScan,
    previousLedgerIndex: number,
    expectedParentHash: string,
  ): BuildNormalizedCollectorPayloadInput {
    const range = this.readNormalizedRange(plan)
    return {
      workId: plan.workId,
      network: this.network,
      epochId: this.epochId,
      baseIdentity: this.baseIdentity,
      previousLedgerIndex,
      expectedParentHash,
      startLedgerIndex: range.startLedgerIndex,
      endLedgerIndex: range.endLedgerIndex,
      finalLedgerHash: range.finalLedgerHash,
      ledgers: range.ledgers,
      protocolEvents: range.protocolEvents,
      objectChanges: range.objectChanges,
      loanLifecycleEvents: range.loanLifecycleEvents,
      archivedObjects: range.archivedObjects,
      balanceHistory: range.balanceHistory,
      currentProjectionMutations: range.currentProjectionMutations,
    }
  }

  afterScanStaging(): void {
    this.counters.stagedMutationHooks += 1
    this.maybeFail('after_scan_staging')
  }

  afterCommitMutation(): void {
    this.maybeFail('after_commit_mutation')
  }

  snapshotCounters(): PortableFixtureExecutionCounters {
    return { ...this.counters }
  }

  private maybeFail(stage: PortableFixtureFailureStage): void {
    const failure = this.failures.find(
      (candidate) => candidate.stage === stage && candidate.remaining > 0,
    )
    if (!failure) return
    failure.remaining -= 1
    throw new PortableFixtureExecutionError(failure.classification, failure.message)
  }
}
