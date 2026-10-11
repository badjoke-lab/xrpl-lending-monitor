import { describe, expect, it } from 'vitest'

import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { NormalizedCandidateV1 } from '../../shared/portable-collector-payload'
import { buildDbLessCurrentProjectionCanonicalKey } from '../../shared/db-less/current-projection-identity'
import { resolveVaultTail, serializeStaticVault } from './staticVaultDetail'

const ID = 'A'.repeat(64)
const OTHER = 'B'.repeat(64)

function vault(id: string = ID): VaultCurrentProjection {
  return {
    kind: 'vault',
    id,
    owner: 'rOwner',
    account: 'rAccount',
    asset: { type: 'xrp', key: 'XRP', scale: 6 },
    assetsTotal: '10',
    assetsAvailable: '9',
    assetsMaximum: null,
    lossUnrealized: '0',
    shareMptId: ID,
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: ID,
    previousLedgerIndex: 100,
    raw: {},
  }
}

function mutation(id: string, isTombstone = false): NormalizedCandidateV1 {
  return {
    semanticClass: 'current-projection',
    canonicalKey: buildDbLessCurrentProjectionCanonicalKey('vault', id),
    sourceLedgerIndex: 101,
    sourceLedgerHash: ID,
    sourceTransactionHash: OTHER,
    objectId: id,
    relationshipIds: [],
    isTombstone,
    value: isTombstone ? null : vault(id),
  }
}

describe('D5 verified static Vault detail', () => {
  it('serializes exact units and derived utilization with legacy API field names', () => {
    const record = serializeStaticVault(vault())
    expect(record.assets_total).toBe('10')
    expect(record.assets_available).toBe('9')
    expect(record.derived.used_assets).toBe('1')
    expect(record.derived.utilization_bps).toBe(1000)
    expect(record.provenance.object).toBe('direct')
  })

  it('uses the newest D3 mutation including tombstones', () => {
    const value = resolveVaultTail(ID, [
      { records: [mutation(ID), mutation(OTHER)] },
      { records: [mutation(ID, true)] },
    ])
    expect(value).toEqual({ present: true, value: null })
  })

  it('does not shadow D4 or D2 when the indexed tail has no matching Vault', () => {
    expect(resolveVaultTail(ID, [{ records: [mutation(OTHER)] }]))
      .toEqual({ present: false, value: null })
  })

  it('fails closed on a mismatched projection identity', () => {
    const record = { ...mutation(ID), value: vault(OTHER) }
    expect(() => resolveVaultTail(ID, [{ records: [record] }]))
      .toThrow(/does not match its identity/)
  })
})
