import { scanValidatedLedgerRange } from './scan-validated-ledgers'

export async function runBoundedLedgerScan(
  options: Parameters<typeof scanValidatedLedgerRange>[0],
) {
  return scanValidatedLedgerRange(options)
}
