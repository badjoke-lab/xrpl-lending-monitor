import {
  formatExactDecimal,
  multiplyExactDecimalByInteger,
  parseExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../domain/asset/decimal'
import type { NormalizedObjectChange } from './affected-nodes'

export type BalanceMetricType =
  | 'debt_total'
  | 'debt_maximum'
  | 'cover_available'
  | 'loss_unrealized'
  | 'required_minimum_cover'
  | 'cover_surplus'

export interface BalanceHistoryRecord {
  network: 'devnet' | 'mainnet'
  epochId: string
  subjectType: 'Vault' | 'LoanBroker'
  subjectId: string
  transactionHash: string
  ledgerIndex: number
  transactionIndex: number
  closeTime: number
  metricType: BalanceMetricType
  assetKey: string | null
  beforeValue: string | null
  afterValue: string | null
  formula: string | null
  sourceFieldsJson: string
}

const DIRECT_METRICS = new Map<string, BalanceMetricType>([
  ['DebtTotal', 'debt_total'],
  ['DebtMaximum', 'debt_maximum'],
  ['CoverAvailable', 'cover_available'],
  ['LossUnrealized', 'loss_unrealized'],
])

function parseJson(value: string | null): unknown {
  if (value === null) return null
  return JSON.parse(value)
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return null
}

function decimalValue(value: unknown): ExactDecimal | null {
  const string = stringValue(value)
  return string === null ? null : parseExactDecimal(string)
}

function rateValue(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  return null
}

function multiplyByTenthsBasisPoints(amount: ExactDecimal, rate: bigint): ExactDecimal {
  return {
    coefficient: multiplyExactDecimalByInteger(amount, rate).coefficient,
    scale: amount.scale + 5,
  }
}

function fieldMap(changes: readonly NormalizedObjectChange[]): Map<string, NormalizedObjectChange> {
  return new Map(changes.map((change) => [change.fieldName, change]))
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

function metricRecord(
  change: NormalizedObjectChange,
  metricType: BalanceMetricType,
  beforeValue: string | null,
  afterValue: string | null,
  formula: string | null,
  sourceFields: readonly string[],
): BalanceHistoryRecord {
  return {
    network: change.network,
    epochId: change.epochId,
    subjectType: change.objectType as 'Vault' | 'LoanBroker',
    subjectId: change.objectId,
    transactionHash: change.transactionHash,
    ledgerIndex: change.ledgerIndex,
    transactionIndex: change.transactionIndex,
    closeTime: change.closeTime,
    metricType,
    assetKey: change.relationships.assetKey,
    beforeValue,
    afterValue,
    formula,
    sourceFieldsJson: stableJson([...sourceFields].sort()),
  }
}

function derivedCoverRecords(
  first: NormalizedObjectChange,
  fields: Map<string, NormalizedObjectChange>,
): BalanceHistoryRecord[] {
  const debt = fields.get('DebtTotal')
  const cover = fields.get('CoverAvailable')
  const rate = fields.get('CoverRateMinimum')
  if (!debt || !cover || !rate) return []

  const beforeDebt = decimalValue(parseJson(debt.beforeJson))
  const afterDebt = decimalValue(parseJson(debt.afterJson))
  const beforeCover = decimalValue(parseJson(cover.beforeJson))
  const afterCover = decimalValue(parseJson(cover.afterJson))
  const beforeRate = rateValue(parseJson(rate.beforeJson))
  const afterRate = rateValue(parseJson(rate.afterJson))
  if (!beforeDebt || !afterDebt || !beforeCover || !afterCover || beforeRate === null || afterRate === null) {
    return []
  }

  const beforeRequired = multiplyByTenthsBasisPoints(beforeDebt, beforeRate)
  const afterRequired = multiplyByTenthsBasisPoints(afterDebt, afterRate)
  const beforeSurplus = subtractExactDecimals(beforeCover, beforeRequired)
  const afterSurplus = subtractExactDecimals(afterCover, afterRequired)
  const sourceFields = ['CoverAvailable', 'CoverRateMinimum', 'DebtTotal']

  return [
    metricRecord(
      first,
      'required_minimum_cover',
      formatExactDecimal(beforeRequired),
      formatExactDecimal(afterRequired),
      'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
      sourceFields,
    ),
    metricRecord(
      first,
      'cover_surplus',
      formatExactDecimal(beforeSurplus),
      formatExactDecimal(afterSurplus),
      'cover_surplus = CoverAvailable - required_minimum_cover',
      sourceFields,
    ),
  ]
}

export function deriveBalanceHistory(
  changes: readonly NormalizedObjectChange[],
): BalanceHistoryRecord[] {
  const grouped = new Map<string, NormalizedObjectChange[]>()
  for (const change of changes) {
    if (change.objectType !== 'Vault' && change.objectType !== 'LoanBroker') continue
    const key = [
      change.network,
      change.epochId,
      change.objectType,
      change.objectId,
      change.transactionHash,
      change.nodeIndex,
    ].join(':')
    const group = grouped.get(key) ?? []
    group.push(change)
    grouped.set(key, group)
  }

  const records: BalanceHistoryRecord[] = []
  for (const group of grouped.values()) {
    group.sort((left, right) => left.fieldName.localeCompare(right.fieldName))
    const first = group[0]
    if (!first) continue
    const fields = fieldMap(group)
    for (const change of group) {
      const metricType = DIRECT_METRICS.get(change.fieldName)
      if (!metricType) continue
      records.push(
        metricRecord(
          change,
          metricType,
          stringValue(parseJson(change.beforeJson)),
          stringValue(parseJson(change.afterJson)),
          null,
          [change.fieldName],
        ),
      )
    }
    records.push(...derivedCoverRecords(first, fields))
  }

  return records.sort(
    (left, right) =>
      left.ledgerIndex - right.ledgerIndex ||
      left.transactionIndex - right.transactionIndex ||
      left.subjectId.localeCompare(right.subjectId) ||
      left.metricType.localeCompare(right.metricType),
  )
}
