export interface ValidatedLedgerTransaction {
  hash: string
  transactionType: string
  account: string | null
  sequence: number | null
  fee: string | null
  result: string
  transactionIndex: number
  transaction: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface ValidatedLedgerRead {
  endpoint: string
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  closeTime: number
  transactions: readonly ValidatedLedgerTransaction[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return null
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return Number(parsed)
}

function optionalInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return Number.isSafeInteger(parsed) && Number(parsed) >= 0 ? Number(parsed) : null
}

function recordFrom(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function transactionBody(entry: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(entry.tx_json)) return entry.tx_json
  if (isRecord(entry.tx)) return entry.tx
  return entry
}

function transactionMetadata(entry: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(entry.meta)) return entry.meta
  if (isRecord(entry.metaData)) return entry.metaData
  if (isRecord(entry.meta_data)) return entry.meta_data
  throw new Error('Expanded ledger transaction did not include metadata')
}

function parseTransaction(value: unknown): ValidatedLedgerTransaction {
  const entry = recordFrom(value, 'Expanded ledger transaction')
  const transaction = transactionBody(entry)
  const metadata = transactionMetadata(entry)
  const hash = requiredString(entry.hash ?? transaction.hash, 'Transaction hash')
  const transactionType = requiredString(transaction.TransactionType, 'TransactionType')
  const result = requiredString(metadata.TransactionResult, 'TransactionResult')
  const transactionIndex = requiredInteger(metadata.TransactionIndex, 'TransactionIndex')

  return {
    hash,
    transactionType,
    account: optionalString(transaction.Account),
    sequence: optionalInteger(transaction.Sequence),
    fee: optionalString(transaction.Fee),
    result,
    transactionIndex,
    transaction: { ...transaction },
    metadata: { ...metadata },
  }
}

function field(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name]
  }
  return undefined
}

export function parseValidatedLedgerResult(options: {
  endpoint: string
  requestedLedgerIndex: number
  result: Record<string, unknown>
}): ValidatedLedgerRead {
  const ledger = recordFrom(options.result.ledger, 'ledger result')
  const validated = options.result.validated ?? ledger.validated
  if (validated !== true) throw new Error(`Ledger ${options.requestedLedgerIndex} is not validated`)

  const ledgerIndex = requiredInteger(
    field(options.result, 'ledger_index') ?? field(ledger, 'ledger_index', 'seqNum'),
    'ledger_index',
  )
  if (ledgerIndex !== options.requestedLedgerIndex) {
    throw new Error(`Requested ledger ${options.requestedLedgerIndex} but received ${ledgerIndex}`)
  }
  const transactions = ledger.transactions
  if (!Array.isArray(transactions)) throw new Error('ledger transactions must be an array')

  return {
    endpoint: options.endpoint,
    ledgerIndex,
    ledgerHash: requiredString(
      field(options.result, 'ledger_hash') ?? field(ledger, 'ledger_hash', 'hash'),
      'ledger_hash',
    ),
    parentHash: requiredString(field(ledger, 'parent_hash', 'parentHash'), 'parent_hash'),
    closeTime: requiredInteger(field(ledger, 'close_time', 'closeTime'), 'close_time'),
    transactions: transactions.map(parseTransaction).sort(
      (left, right) => left.transactionIndex - right.transactionIndex,
    ),
  }
}
