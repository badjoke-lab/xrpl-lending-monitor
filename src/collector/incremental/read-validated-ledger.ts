import { XrplJsonRpcClient, type FetchLike } from '../network/xrpl-rpc'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from './validated-ledger-parser'

export { parseValidatedLedgerResult } from './validated-ledger-parser'
export type {
  ValidatedLedgerRead,
  ValidatedLedgerTransaction,
} from './validated-ledger-parser'

export async function readValidatedLedger(options: {
  endpoint: string
  ledgerIndex: number
  timeoutMs: number
  fetcher?: FetchLike
}): Promise<ValidatedLedgerRead> {
  const client = new XrplJsonRpcClient({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    fetcher: options.fetcher,
  })
  const result = await client.call<Record<string, unknown>>('ledger', {
    ledger_index: options.ledgerIndex,
    transactions: true,
    expand: true,
    owner_funds: false,
  })
  return parseValidatedLedgerResult({
    endpoint: options.endpoint,
    requestedLedgerIndex: options.ledgerIndex,
    result,
  })
}
