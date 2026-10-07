import { DirectXrplReadProvider, type XrplReadProvider } from '../network/xrpl-read-provider'
import { type FetchLike } from '../network/xrpl-rpc'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from './validated-ledger-parser'

export async function readValidatedLedgerFromProvider(options: {
  provider: XrplReadProvider
  ledgerIndex: number
}): Promise<ValidatedLedgerRead> {
  const result = await options.provider.call<Record<string, unknown>>('ledger', {
    ledger_index: options.ledgerIndex,
    transactions: true,
    expand: true,
    owner_funds: false,
  })

  return parseValidatedLedgerResult({
    endpoint: options.provider.endpoint,
    requestedLedgerIndex: options.ledgerIndex,
    result,
  })
}

export async function readValidatedLedger(options: {
  endpoint: string
  ledgerIndex: number
  timeoutMs: number
  fetcher?: FetchLike
}): Promise<ValidatedLedgerRead> {
  const provider = new DirectXrplReadProvider({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    fetcher: options.fetcher,
  })
  return readValidatedLedgerFromProvider({
    provider,
    ledgerIndex: options.ledgerIndex,
  })
}
