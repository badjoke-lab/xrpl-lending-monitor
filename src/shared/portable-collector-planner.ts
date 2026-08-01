export const PORTABLE_SCAN_LEDGER_CEILING = 48

export interface PortableScanBudget {
  maxLedgers: number
  maxTransactions: number
  maxDecodedBytes: number
  maxNormalizedBytes: number
  maxPayloadBytes: number
  maxExternalRequests: number
}

export interface PortableLedgerCostEstimate {
  ledgerIndex: number
  transactionCount: number
  decodedBytes: number
  normalizedBytes: number
  payloadBytes: number
  externalRequests: number
}

export interface PortableScanBudgetUsage {
  ledgers: number
  transactions: number
  decodedBytes: number
  normalizedBytes: number
  payloadBytes: number
  externalRequests: number
}

export interface PortableCollectorIdentity {
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
}

export interface PortablePlannedScan {
  status: 'planned'
  workId: string
  startLedgerIndex: number
  endLedgerIndex: number
  latestValidatedLedgerIndex: number
  selected: PortableLedgerCostEstimate[]
  usage: PortableScanBudgetUsage
  stoppedBeforeLedgerIndex: number | null
  planJson: string
}

export interface PortableBlockedScan {
  status: 'blocked'
  ledgerIndex: number
  reason: 'single-ledger-budget-exceeded'
  exceededBudgets: Array<keyof PortableScanBudgetUsage>
}

export interface PortableCaughtUpScan {
  status: 'caught_up'
  ledgerIndex: number
}

export type PortableScanPlan = PortablePlannedScan | PortableBlockedScan | PortableCaughtUpScan

export interface PlanPortableScanInput extends PortableCollectorIdentity {
  latestValidatedLedgerIndex: number
  budget: PortableScanBudget
  estimates: PortableLedgerCostEstimate[]
}

const EMPTY_USAGE: PortableScanBudgetUsage = {
  ledgers: 0,
  transactions: 0,
  decodedBytes: 0,
  normalizedBytes: 0,
  payloadBytes: 0,
  externalRequests: 0,
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

function validateBudget(budget: PortableScanBudget): void {
  requirePositiveInteger(budget.maxLedgers, 'maxLedgers')
  requirePositiveInteger(budget.maxTransactions, 'maxTransactions')
  requirePositiveInteger(budget.maxDecodedBytes, 'maxDecodedBytes')
  requirePositiveInteger(budget.maxNormalizedBytes, 'maxNormalizedBytes')
  requirePositiveInteger(budget.maxPayloadBytes, 'maxPayloadBytes')
  requirePositiveInteger(budget.maxExternalRequests, 'maxExternalRequests')

  if (budget.maxLedgers > PORTABLE_SCAN_LEDGER_CEILING) {
    throw new Error(`maxLedgers must not exceed the R1 ceiling of ${PORTABLE_SCAN_LEDGER_CEILING}`)
  }
}

function validateEstimate(estimate: PortableLedgerCostEstimate): void {
  requireNonNegativeInteger(estimate.ledgerIndex, 'ledgerIndex')
  requireNonNegativeInteger(estimate.transactionCount, 'transactionCount')
  requireNonNegativeInteger(estimate.decodedBytes, 'decodedBytes')
  requireNonNegativeInteger(estimate.normalizedBytes, 'normalizedBytes')
  requireNonNegativeInteger(estimate.payloadBytes, 'payloadBytes')
  requireNonNegativeInteger(estimate.externalRequests, 'externalRequests')
}

function addEstimate(
  usage: PortableScanBudgetUsage,
  estimate: PortableLedgerCostEstimate,
): PortableScanBudgetUsage {
  return {
    ledgers: usage.ledgers + 1,
    transactions: usage.transactions + estimate.transactionCount,
    decodedBytes: usage.decodedBytes + estimate.decodedBytes,
    normalizedBytes: usage.normalizedBytes + estimate.normalizedBytes,
    payloadBytes: usage.payloadBytes + estimate.payloadBytes,
    externalRequests: usage.externalRequests + estimate.externalRequests,
  }
}

function exceededBudgets(
  usage: PortableScanBudgetUsage,
  budget: PortableScanBudget,
): Array<keyof PortableScanBudgetUsage> {
  const exceeded: Array<keyof PortableScanBudgetUsage> = []
  if (usage.ledgers > budget.maxLedgers) exceeded.push('ledgers')
  if (usage.transactions > budget.maxTransactions) exceeded.push('transactions')
  if (usage.decodedBytes > budget.maxDecodedBytes) exceeded.push('decodedBytes')
  if (usage.normalizedBytes > budget.maxNormalizedBytes) exceeded.push('normalizedBytes')
  if (usage.payloadBytes > budget.maxPayloadBytes) exceeded.push('payloadBytes')
  if (usage.externalRequests > budget.maxExternalRequests) exceeded.push('externalRequests')
  return exceeded
}

function normalizedIdentityPart(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return encodeURIComponent(normalized)
}

export function buildPortableCollectorWorkId(identity: PortableCollectorIdentity): string {
  requireNonNegativeInteger(identity.previousLedgerIndex, 'previousLedgerIndex')
  const parentHash = identity.expectedParentHash.trim().toUpperCase()
  if (!parentHash) throw new Error('expectedParentHash is required')

  return [
    'collector-work-v1',
    normalizedIdentityPart(identity.network, 'network'),
    normalizedIdentityPart(identity.epochId, 'epochId'),
    normalizedIdentityPart(identity.baseIdentity, 'baseIdentity'),
    String(identity.previousLedgerIndex + 1),
    encodeURIComponent(parentHash),
  ].join(':')
}

export function planPortableCollectorScan(input: PlanPortableScanInput): PortableScanPlan {
  requireNonNegativeInteger(input.previousLedgerIndex, 'previousLedgerIndex')
  requireNonNegativeInteger(input.latestValidatedLedgerIndex, 'latestValidatedLedgerIndex')
  validateBudget(input.budget)

  if (input.previousLedgerIndex >= input.latestValidatedLedgerIndex) {
    return { status: 'caught_up', ledgerIndex: input.previousLedgerIndex }
  }

  const startLedgerIndex = input.previousLedgerIndex + 1
  if (input.estimates.length === 0) {
    throw new Error(`cost estimates must begin at ledger ${startLedgerIndex}`)
  }

  let expectedLedgerIndex = startLedgerIndex
  let usage = { ...EMPTY_USAGE }
  const selected: PortableLedgerCostEstimate[] = []
  let stoppedBeforeLedgerIndex: number | null = null

  for (const estimate of input.estimates) {
    validateEstimate(estimate)
    if (estimate.ledgerIndex > input.latestValidatedLedgerIndex) break
    if (estimate.ledgerIndex !== expectedLedgerIndex) {
      throw new Error(
        `cost estimates must be contiguous: expected ${expectedLedgerIndex}, received ${estimate.ledgerIndex}`,
      )
    }

    const nextUsage = addEstimate(usage, estimate)
    const exceeded = exceededBudgets(nextUsage, input.budget)
    if (exceeded.length > 0) {
      if (selected.length === 0) {
        return {
          status: 'blocked',
          ledgerIndex: estimate.ledgerIndex,
          reason: 'single-ledger-budget-exceeded',
          exceededBudgets: exceeded,
        }
      }
      stoppedBeforeLedgerIndex = estimate.ledgerIndex
      break
    }

    selected.push({ ...estimate })
    usage = nextUsage
    expectedLedgerIndex += 1
  }

  if (selected.length === 0) {
    throw new Error(`cost estimates did not cover ledger ${startLedgerIndex}`)
  }

  const endLedgerIndex = selected[selected.length - 1]!.ledgerIndex
  const workId = buildPortableCollectorWorkId(input)
  const planJson = JSON.stringify({
    schemaVersion: 1,
    workId,
    network: input.network,
    epochId: input.epochId,
    baseIdentity: input.baseIdentity,
    previousLedgerIndex: input.previousLedgerIndex,
    expectedParentHash: input.expectedParentHash.trim().toUpperCase(),
    startLedgerIndex,
    endLedgerIndex,
    latestValidatedLedgerIndex: input.latestValidatedLedgerIndex,
    budget: input.budget,
    usage,
    stoppedBeforeLedgerIndex,
  })

  return {
    status: 'planned',
    workId,
    startLedgerIndex,
    endLedgerIndex,
    latestValidatedLedgerIndex: input.latestValidatedLedgerIndex,
    selected,
    usage,
    stoppedBeforeLedgerIndex,
    planJson,
  }
}
