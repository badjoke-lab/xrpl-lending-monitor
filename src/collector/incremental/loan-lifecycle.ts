import type { NormalizedObjectChange } from './affected-nodes'

export type LoanLifecycleEventType =
  | 'created'
  | 'payment'
  | 'paid'
  | 'impaired'
  | 'unimpaired'
  | 'defaulted'
  | 'deleted'
  | 'updated'

export type LoanLifecycleOnLedgerStatus = 'active' | 'impaired' | 'defaulted' | 'deleted' | 'unknown'

export interface LoanLifecycleEvent {
  network: 'devnet' | 'mainnet'
  epochId: string
  loanId: string
  transactionHash: string
  ledgerIndex: number
  transactionIndex: number
  closeTime: number
  eventType: LoanLifecycleEventType
  transactionType: string
  result: string
  statusBefore: LoanLifecycleOnLedgerStatus
  statusAfter: LoanLifecycleOnLedgerStatus
  principalBefore: string | null
  principalAfter: string | null
  totalValueBefore: string | null
  totalValueAfter: string | null
  paymentRemainingBefore: number | null
  paymentRemainingAfter: number | null
  detailsJson: string
}

const LOAN_DEFAULT_FLAG = 0x00010000
const LOAN_IMPAIRED_FLAG = 0x00020000

function parseJson(value: string | null): unknown {
  if (value === null) return null
  return JSON.parse(value)
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

function flagStatus(value: unknown): LoanLifecycleOnLedgerStatus {
  const flags = numberValue(value)
  if (flags === null) return 'unknown'
  if ((flags & LOAN_DEFAULT_FLAG) !== 0) return 'defaulted'
  if ((flags & LOAN_IMPAIRED_FLAG) !== 0) return 'impaired'
  return 'active'
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  )
}

function byField(changes: readonly NormalizedObjectChange[]): Map<string, NormalizedObjectChange> {
  return new Map(changes.map((change) => [change.fieldName, change]))
}

function eventType(
  changes: readonly NormalizedObjectChange[],
  fields: Map<string, NormalizedObjectChange>,
): LoanLifecycleEventType {
  const first = changes[0]
  if (!first) return 'updated'
  if (first.action === 'created') return 'created'
  if (first.action === 'deleted') return 'deleted'

  const flags = fields.get('Flags')
  if (flags) {
    const before = flagStatus(parseJson(flags.beforeJson))
    const after = flagStatus(parseJson(flags.afterJson))
    if (after === 'defaulted' && before !== 'defaulted') return 'defaulted'
    if (after === 'impaired' && before !== 'impaired') return 'impaired'
    if (before === 'impaired' && after === 'active') return 'unimpaired'
  }

  if (first.transactionType === 'LoanPay') {
    const paymentRemainingAfter = numberValue(parseJson(fields.get('PaymentRemaining')?.afterJson ?? null))
    return paymentRemainingAfter === 0 ? 'paid' : 'payment'
  }

  return 'updated'
}

function amountPair(fields: Map<string, NormalizedObjectChange>, field: string): [string | null, string | null] {
  const change = fields.get(field)
  if (!change) return [null, null]
  return [stringValue(parseJson(change.beforeJson)), stringValue(parseJson(change.afterJson))]
}

function numberPair(fields: Map<string, NormalizedObjectChange>, field: string): [number | null, number | null] {
  const change = fields.get(field)
  if (!change) return [null, null]
  return [numberValue(parseJson(change.beforeJson)), numberValue(parseJson(change.afterJson))]
}

function statusPair(
  action: NormalizedObjectChange['action'],
  fields: Map<string, NormalizedObjectChange>,
): [LoanLifecycleOnLedgerStatus, LoanLifecycleOnLedgerStatus] {
  if (action === 'created') return ['unknown', flagStatus(parseJson(fields.get('Flags')?.afterJson ?? '0'))]
  if (action === 'deleted') return [flagStatus(parseJson(fields.get('Flags')?.beforeJson ?? null)), 'deleted']
  const flags = fields.get('Flags')
  if (!flags) return ['unknown', 'unknown']
  return [flagStatus(parseJson(flags.beforeJson)), flagStatus(parseJson(flags.afterJson))]
}

export function deriveLoanLifecycleEvents(
  changes: readonly NormalizedObjectChange[],
): LoanLifecycleEvent[] {
  const grouped = new Map<string, NormalizedObjectChange[]>()
  for (const change of changes) {
    if (change.objectType !== 'Loan') continue
    const loanId = change.relationships.loanId ?? change.objectId
    const key = [
      change.network,
      change.epochId,
      loanId,
      change.transactionHash,
      change.nodeIndex,
    ].join(':')
    const group = grouped.get(key) ?? []
    group.push(change)
    grouped.set(key, group)
  }

  return [...grouped.values()]
    .map((group) => {
      group.sort((left, right) => left.fieldName.localeCompare(right.fieldName))
      const first = group[0]
      if (!first) throw new Error('Loan lifecycle group is empty')
      const fields = byField(group)
      const [principalBefore, principalAfter] = amountPair(fields, 'PrincipalOutstanding')
      const [totalValueBefore, totalValueAfter] = amountPair(fields, 'TotalValueOutstanding')
      const [paymentRemainingBefore, paymentRemainingAfter] = numberPair(fields, 'PaymentRemaining')
      const [statusBefore, statusAfter] = statusPair(first.action, fields)
      const loanId = first.relationships.loanId ?? first.objectId

      return {
        network: first.network,
        epochId: first.epochId,
        loanId,
        transactionHash: first.transactionHash,
        ledgerIndex: first.ledgerIndex,
        transactionIndex: first.transactionIndex,
        closeTime: first.closeTime,
        eventType: eventType(group, fields),
        transactionType: first.transactionType,
        result: first.result,
        statusBefore,
        statusAfter,
        principalBefore,
        principalAfter,
        totalValueBefore,
        totalValueAfter,
        paymentRemainingBefore,
        paymentRemainingAfter,
        detailsJson: stableJson({
          changed_fields: group.map((change) => change.fieldName),
          node_index: first.nodeIndex,
          unsupported_fields: group
            .filter((change) => change.unsupportedField)
            .map((change) => change.fieldName),
        }),
      }
    })
    .sort(
      (left, right) =>
        left.ledgerIndex - right.ledgerIndex ||
        left.transactionIndex - right.transactionIndex ||
        left.loanId.localeCompare(right.loanId) ||
        left.eventType.localeCompare(right.eventType),
    )
}
