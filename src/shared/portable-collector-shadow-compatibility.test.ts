import { describe, expect, it, vi } from 'vitest'

import type {
  PortableProductRecordV1,
} from './portable-collector-product-mappers'
import {
  executeLegacyAuthoritativeRead,
  PortableShadowCompatibilityError,
  type PortableShadowSnapshotV1,
} from './portable-collector-shadow-compatibility'

const ledgerHash = 'A'.repeat(64)

function product(id: string): PortableProductRecordV1 {
  return {
    schemaVersion: 1,
    kind: 'protocol_event',
    provenance: {
      schemaVersion: 1,
      workId: 'work-101',
      semanticClass: 'protocol-event',
      canonicalKey: id,
      sourceLedgerIndex: 101,
      sourceLedgerHash: ledgerHash,
      sourceTransactionHash: 'B'.repeat(64),
      objectId: null,
      relationshipIds: [],
      isTombstone: false,
      createdAt: '2026-08-01T16:30:00.000Z',
    },
    eventId: id,
    transactionHash: 'B'.repeat(64),
    eventIndex: 0,
    closeTime: 1_700_000_000,
    eventType: 'LoanSet',
    resultCode: 'tesSUCCESS',
    details: {
      eventIndex: 0,
      closeTime: 1_700_000_000,
      eventType: 'LoanSet',
      resultCode: 'tesSUCCESS',
    },
  }
}

function portable(records: PortableProductRecordV1[]): PortableShadowSnapshotV1 {
  return {
    schemaVersion: 1,
    source: {
      schemaVersion: 1,
      sourceId: 'sqlite-portable',
      mode: 'portable',
    },
    fence: {
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      ledgerIndex: 101,
      ledgerHash,
      workId: 'work-101',
    },
    records,
  }
}

describe('R3C legacy-authoritative shadow compatibility', () => {
  it('returns only the legacy response in legacy_only mode', async () => {
    const portableRead = vi.fn(async () => portable([product('event:1')]))
    const legacyResponse = { items: [product('event:1')], nextCursor: null }

    const result = await executeLegacyAuthoritativeRead({
      mode: 'legacy_only',
      legacySourceId: 'legacy-d1-history',
      legacyRead: async () => legacyResponse,
      normalizeLegacy: (response) => response.items,
      portableRead,
      maxRecords: 10,
    })

    expect(result).toEqual({
      schemaVersion: 1,
      authority: {
        schemaVersion: 1,
        mode: 'legacy',
        sourceId: 'legacy-d1-history',
      },
      response: legacyResponse,
      shadowEvidence: null,
    })
    expect(portableRead).not.toHaveBeenCalled()
  })

  it('records deterministic match evidence without mixing portable rows into the response', async () => {
    const records = [product('event:1'), product('event:2')]
    const legacyResponse = { items: records, nextCursor: 'legacy-cursor' }

    const result = await executeLegacyAuthoritativeRead({
      mode: 'shadow_compare',
      legacySourceId: 'legacy-d1-history',
      legacyRead: async () => legacyResponse,
      normalizeLegacy: (response) => response.items,
      portableRead: async () => portable(records),
      maxRecords: 10,
    })

    expect(result.response).toBe(legacyResponse)
    expect(result.authority.mode).toBe('legacy')
    expect(result.shadowEvidence).toMatchObject({
      status: 'match',
      legacySourceId: 'legacy-d1-history',
      portableSourceId: 'sqlite-portable',
      legacyCount: 2,
      portableCount: 2,
      firstMismatchIndex: null,
      errorCode: null,
    })
    expect(result.shadowEvidence?.legacyDigest).toBe(
      result.shadowEvidence?.portableDigest,
    )
    expect(result).not.toHaveProperty('portableRecords')
  })

  it('records mismatch evidence while preserving legacy authority', async () => {
    const legacyResponse = { items: [product('event:1')] }
    const result = await executeLegacyAuthoritativeRead({
      mode: 'shadow_compare',
      legacySourceId: 'legacy-current-release',
      legacyRead: async () => legacyResponse,
      normalizeLegacy: (response) => response.items,
      portableRead: async () => portable([product('event:changed')]),
      maxRecords: 10,
    })

    expect(result.response).toBe(legacyResponse)
    expect(result.authority.sourceId).toBe('legacy-current-release')
    expect(result.shadowEvidence).toMatchObject({
      status: 'mismatch',
      firstMismatchIndex: 0,
      legacyCount: 1,
      portableCount: 1,
    })
    expect(result.shadowEvidence?.legacyDigest).not.toBe(
      result.shadowEvidence?.portableDigest,
    )
  })

  it('records portable integrity failures instead of silently treating them as matches', async () => {
    const legacyResponse = { items: [product('event:1')] }
    const result = await executeLegacyAuthoritativeRead({
      mode: 'shadow_compare',
      legacySourceId: 'legacy-d1-history',
      legacyRead: async () => legacyResponse,
      normalizeLegacy: (response) => response.items,
      portableRead: async () => {
        const error = new Error('portable candidate digest mismatch') as Error & {
          code: string
        }
        error.code = 'integrity_failure'
        throw error
      },
      maxRecords: 10,
    })

    expect(result.response).toBe(legacyResponse)
    expect(result.shadowEvidence).toMatchObject({
      status: 'portable_error',
      portableSourceId: null,
      portableCount: null,
      errorCode: 'portable:unknown',
      errorMessage: 'portable candidate digest mismatch',
    })
  })

  it('skips comparison before calling portable when the legacy page exceeds the bound', async () => {
    const portableRead = vi.fn(async () => portable([]))
    const legacyResponse = {
      items: [product('event:1'), product('event:2')],
    }
    const result = await executeLegacyAuthoritativeRead({
      mode: 'shadow_compare',
      legacySourceId: 'legacy-d1-history',
      legacyRead: async () => legacyResponse,
      normalizeLegacy: (response) => response.items,
      portableRead,
      maxRecords: 1,
    })

    expect(result.shadowEvidence).toMatchObject({
      status: 'skipped_limit',
      legacyCount: 2,
      portableCount: null,
    })
    expect(portableRead).not.toHaveBeenCalled()
  })

  it('rejects invalid mode configuration and legacy normalization failure', async () => {
    await expect(
      executeLegacyAuthoritativeRead({
        mode: 'shadow_compare',
        legacySourceId: 'legacy',
        legacyRead: async () => ({ items: [] }),
        normalizeLegacy: (response) => response.items,
        maxRecords: 10,
      }),
    ).rejects.toMatchObject({ code: 'invalid_configuration' })

    await expect(
      executeLegacyAuthoritativeRead({
        mode: 'legacy_only',
        legacySourceId: 'legacy',
        legacyRead: async () => ({ items: [] }),
        normalizeLegacy: () => {
          throw new Error('legacy serializer failed')
        },
        maxRecords: 10,
      }),
    ).rejects.toBeInstanceOf(PortableShadowCompatibilityError)
  })
})
