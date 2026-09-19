export const LENDING_LEDGER_ENTRY_TYPES = ['Vault', 'LoanBroker', 'Loan'] as const

export type LendingLedgerEntryType = typeof LENDING_LEDGER_ENTRY_TYPES[number]

export type LendingCurrentKind = 'vault' | 'loan-broker' | 'loan'

export interface FixedValidatedLedgerIdentity {
  ledgerIndex: number
  ledgerHash: string
}

export interface FilteredLedgerObject {
  sourcePage: number
  entryType: LendingLedgerEntryType
  objectId: string
  value: Record<string, unknown>
}

export interface FilteredLedgerPage {
  sourcePage: number
  typePage: number
  entryType: LendingLedgerEntryType
  records: FilteredLedgerObject[]
}

export interface FilteredLedgerTraversalCounts {
  vaults: number
  loanBrokers: number
  loans: number
}

export interface FilteredLedgerTraversalResult {
  sourcePages: number
  pagesByType: Record<LendingLedgerEntryType, number>
  decodedObjectCount: number
  relevantObjectCount: number
  counts: FilteredLedgerTraversalCounts
  complete: true
}

type LedgerDataResult = {
  ledger_hash?: unknown
  ledger_index?: unknown
  validated?: unknown
  state?: unknown
  marker?: unknown
}

export interface FilteredLedgerTraversalOptions {
  ledger: FixedValidatedLedgerIdentity
  objectLimitPerPage: number
  pageLimitPerType: number
  callLedgerData: (params: Record<string, unknown>) => Promise<unknown>
  decodeBinary: (binaryHex: string) => unknown
  onPage: (page: FilteredLedgerPage) => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function requiredHex(value: unknown, field: string): string {
  const hex = requiredString(value, field)
  if (hex.length % 2 !== 0 || !/^[A-Fa-f0-9]+$/.test(hex)) {
    throw new Error(`${field} must be an even-length hexadecimal string`)
  }
  return hex.toUpperCase()
}

function requiredLedgerIndex(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) {
    throw new Error('ledger_index must be a positive safe integer')
  }
  return Number(parsed)
}

function hash64(value: unknown, field: string): string {
  const normalized = requiredString(value, field).toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a 64-character hexadecimal value`)
  return normalized
}

function markerFingerprint(marker: unknown): string {
  try {
    return JSON.stringify(marker)
  } catch {
    throw new Error('ledger_data marker could not be serialized')
  }
}

function countForType(counts: FilteredLedgerTraversalCounts, entryType: LendingLedgerEntryType, amount: number): void {
  if (entryType === 'Vault') counts.vaults += amount
  else if (entryType === 'LoanBroker') counts.loanBrokers += amount
  else counts.loans += amount
}

export function currentKindForLedgerEntryType(entryType: LendingLedgerEntryType): LendingCurrentKind {
  if (entryType === 'Vault') return 'vault'
  if (entryType === 'LoanBroker') return 'loan-broker'
  return 'loan'
}

export async function streamFilteredLendingLedgerObjects(
  options: FilteredLedgerTraversalOptions,
): Promise<FilteredLedgerTraversalResult> {
  if (!Number.isSafeInteger(options.ledger.ledgerIndex) || options.ledger.ledgerIndex < 1) {
    throw new Error('ledger.ledgerIndex must be a positive safe integer')
  }
  const ledgerHash = hash64(options.ledger.ledgerHash, 'ledger.ledgerHash')
  if (!Number.isSafeInteger(options.objectLimitPerPage) || options.objectLimitPerPage < 1) {
    throw new Error('objectLimitPerPage must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.pageLimitPerType) || options.pageLimitPerType < 1) {
    throw new Error('pageLimitPerType must be a positive safe integer')
  }

  const counts: FilteredLedgerTraversalCounts = { vaults: 0, loanBrokers: 0, loans: 0 }
  const pagesByType: Record<LendingLedgerEntryType, number> = {
    Vault: 0,
    LoanBroker: 0,
    Loan: 0,
  }
  let sourcePages = 0
  let decodedObjectCount = 0
  let relevantObjectCount = 0

  for (const entryType of LENDING_LEDGER_ENTRY_TYPES) {
    const seenMarkers = new Set<string>()
    let marker: unknown = undefined
    let typePage = 0

    for (;;) {
      if (typePage >= options.pageLimitPerType) {
        throw new Error(`ledger_data ${entryType} traversal exceeded page limit ${options.pageLimitPerType} before marker exhaustion`)
      }

      const params: Record<string, unknown> = {
        ledger_hash: ledgerHash,
        binary: true,
        limit: options.objectLimitPerPage,
        type: entryType,
      }
      if (marker !== undefined) params.marker = marker

      const raw = await options.callLedgerData(params)
      if (!isRecord(raw)) throw new Error('ledger_data result must be an object')
      const result = raw as LedgerDataResult
      const responseHash = hash64(result.ledger_hash, 'ledger_hash')
      const responseIndex = requiredLedgerIndex(result.ledger_index)
      if (responseHash !== ledgerHash || responseIndex !== options.ledger.ledgerIndex) {
        throw new Error(`ledger_data moved during ${entryType} traversal`)
      }
      if (result.validated !== true) throw new Error('ledger_data response must describe a validated ledger')
      if (!Array.isArray(result.state)) throw new Error('ledger_data response state must be an array')

      typePage += 1
      sourcePages += 1
      pagesByType[entryType] = typePage
      const records: FilteredLedgerObject[] = []

      for (let index = 0; index < result.state.length; index += 1) {
        const stateEntry = result.state[index]
        if (!isRecord(stateEntry)) throw new Error(`state[${index}] must be an object`)
        const binaryHex = requiredHex(stateEntry.data, `state[${index}].data`)
        const decoded = options.decodeBinary(binaryHex)
        if (!isRecord(decoded)) throw new Error(`state[${index}] did not decode to an object`)
        if (decoded.LedgerEntryType !== entryType) {
          throw new Error(`ledger_data type filter ${entryType} returned ${String(decoded.LedgerEntryType)}`)
        }
        const objectId = hash64(stateEntry.index, `state[${index}].index`)
        decodedObjectCount += 1
        relevantObjectCount += 1
        countForType(counts, entryType, 1)
        records.push({
          sourcePage: sourcePages,
          entryType,
          objectId,
          value: {
            ...decoded,
            LedgerEntryType: entryType,
            index: objectId,
          },
        })
      }

      await options.onPage({
        sourcePage: sourcePages,
        typePage,
        entryType,
        records,
      })

      marker = result.marker
      if (marker === undefined || marker === null) break
      const fingerprint = markerFingerprint(marker)
      if (seenMarkers.has(fingerprint)) {
        throw new Error(`ledger_data repeated marker for ${entryType} after page ${typePage}`)
      }
      seenMarkers.add(fingerprint)
    }
  }

  return {
    sourcePages,
    pagesByType,
    decodedObjectCount,
    relevantObjectCount,
    counts,
    complete: true,
  }
}
