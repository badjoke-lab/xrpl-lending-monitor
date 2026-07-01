import { mkdir, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { readNetworkSnapshot } from '../network/read-network-snapshot'
import { isLendingTransactionType } from './lending-transaction-types'
import { readValidatedLedger } from './read-validated-ledger'

const runLive = process.env.RUN_LIVE_INCREMENTAL_LEDGER_READ === 'true'
const endpoint = process.env.XRPL_DEVNET_RPC_URL ?? 'https://s.devnet.rippletest.net:51234/'
const artifactPath = 'artifacts/incremental-ledger-read.json'

async function writeArtifact(value: unknown): Promise<void> {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

describe.runIf(runLive)('live validated ledger read', () => {
  it('parses one current Devnet ledger with expanded metadata', async () => {
    const network = await readNetworkSnapshot({ endpoints: [endpoint], timeoutMs: 15_000 })
    const ledger = await readValidatedLedger({
      endpoint: network.endpoint,
      ledgerIndex: network.validatedLedger.index,
      timeoutMs: 15_000,
    })
    const matched = ledger.transactions.filter((item) =>
      isLendingTransactionType(item.transactionType),
    )
    const artifact = {
      schema_version: 1,
      observed_at: network.observedAt,
      endpoint: ledger.endpoint,
      ledger_index: ledger.ledgerIndex,
      ledger_hash: ledger.ledgerHash,
      parent_hash: ledger.parentHash,
      close_time: ledger.closeTime,
      inspected_transactions: ledger.transactions.length,
      matched_protocol_events: matched.length,
      observed_types: [...new Set(ledger.transactions.map((item) => item.transactionType))].sort(),
      matched_types: [...new Set(matched.map((item) => item.transactionType))].sort(),
    }
    await writeArtifact(artifact)
    console.info(`INCREMENTAL_LEDGER_READ=${JSON.stringify(artifact)}`)

    expect(ledger.ledgerIndex).toBe(network.validatedLedger.index)
    expect(ledger.ledgerHash).toBe(network.validatedLedger.hash)
    expect(ledger.parentHash).toMatch(/^[A-F0-9]{64}$/)
    expect(ledger.transactions.every((item, index, values) => {
      if (index === 0) return true
      return item.transactionIndex >= (values[index - 1]?.transactionIndex ?? 0)
    })).toBe(true)
  }, 180_000)
})
