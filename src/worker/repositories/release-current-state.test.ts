import { describe, expect, it } from 'vitest'

import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type {
  GithubCurrentStateReadModelReader,
  ReadModelBrokerRecord,
  ReadModelKind,
  ReadModelLoanRecord,
} from '../../shared/current-state/github-read-model-reader'
import { createReadModelAdapter } from './release-current-state'

const id = (value: number) => value.toString(16).toUpperCase().padStart(64, '0')
const vault = (value: number) => ({ kind: 'vault', id: id(value) }) as VaultCurrentProjection
const broker = (value: number, vaultId: string) => ({
  kind: 'loan_broker', id: id(value), vaultId,
}) as LoanBrokerCurrentProjection
const loan = (value: number, loanBrokerId: string) => ({
  kind: 'loan', id: id(value), loanBrokerId,
}) as LoanCurrentProjection

function model(options: { brokers: ReadModelBrokerRecord[]; loans: ReadModelLoanRecord[] }) {
  let getCalls = 0
  const reader = {
    async list<T>(kind: ReadModelKind, request: { limit: number; predicate?: (item: T) => boolean }) {
      const source = kind === 'loan-broker'
        ? options.brokers
        : kind === 'loan'
          ? options.loans
          : options.brokers.map((item) => item.vault)
      const typed = source as T[]
      const filtered = request.predicate ? typed.filter(request.predicate) : typed
      return { items: filtered.slice(0, request.limit), nextCursor: null, pageReads: 1, objectsExamined: filtered.length }
    },
    async get<T>() { getCalls += 1; return null as T | null },
  } as unknown as GithubCurrentStateReadModelReader
  return { reader, getCalls: () => getCalls }
}

describe('release current-state relationship cache', () => {
  it('reuses embedded Vaults for a 25-row Broker page', async () => {
    const brokers = Array.from({ length: 25 }, (_, index) => {
      const relatedVault = vault(index + 1)
      return { broker: broker(index + 1001, relatedVault.id), vault: relatedVault }
    })
    const source = model({ brokers, loans: [] })
    const adapter = createReadModelAdapter(source.reader, () => { throw new Error('unexpected resolved read') })

    await adapter.listObjects('loan-broker', { limit: 25, direction: 'asc' })
    for (const item of brokers) {
      expect((await adapter.getObject(item.vault.id, { maxAssetReads: 512 })).item?.id).toBe(item.vault.id)
    }
    expect(source.getCalls()).toBe(0)
  })

  it('reuses embedded Broker and Vault records for a 25-row Loan page', async () => {
    const loans = Array.from({ length: 25 }, (_, index) => {
      const relatedVault = vault(index + 1)
      const relatedBroker = broker(index + 1001, relatedVault.id)
      return { loan: loan(index + 2001, relatedBroker.id), broker: relatedBroker, vault: relatedVault }
    })
    const source = model({ brokers: [], loans })
    const adapter = createReadModelAdapter(source.reader, () => { throw new Error('unexpected resolved read') })

    await adapter.listObjects('loan', { limit: 25, direction: 'asc' })
    for (const item of loans) {
      expect((await adapter.getObject(item.broker.id, { maxAssetReads: 512 })).item?.id).toBe(item.broker.id)
      expect((await adapter.getObject(item.vault.id, { maxAssetReads: 512 })).item?.id).toBe(item.vault.id)
    }
    expect(source.getCalls()).toBe(0)
  })
})
