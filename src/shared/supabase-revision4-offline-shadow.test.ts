import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  runSupabaseRevision4OfflineShadow,
  type SupabaseRevision4OfflineShadowFixture,
} from './supabase-revision4-offline-shadow'
import { utf8ByteLength } from './supabase-revision4-directional-meter'
import { SUPABASE_REVISION4_BYTE_BOUNDARIES } from './supabase-revision4-directional-egress-contract'

function readFixture(): SupabaseRevision4OfflineShadowFixture {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'ops/r4f/revision4-offline-shadow-fixture.json',
      ),
      'utf8',
    ),
  ) as SupabaseRevision4OfflineShadowFixture
}

describe('revision-4 G2C offline source-shaped shadow', () => {
  it('parses source-shaped responses, normalizes ledgers, and reaches an exact persistence fixed point', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('offline shadow attempted a network request')
    }) as typeof fetch
    try {
      const result = await runSupabaseRevision4OfflineShadow(readFixture())
      const accounting = result.accountingEvidence.accounting
      const persistenceObservation = accounting.observations.find(
        (observation) => observation.operationId === 'edge.database.request.persist',
      )

      expect(result.mode).toBe('offline_source_shaped_shadow')
      expect(result.normalizedWork).toMatchObject({
        startLedgerIndex: 4_139_119,
        endLedgerIndex: 4_139_120,
        ledgerCount: 2,
        inspectedTransactions: 0,
        lendingTransactions: 0,
        recordCount: 2,
        chunkCount: 1,
      })
      expect(result.normalizedWork.payloadBytes).toBeGreaterThan(0)
      expect(result.normalizedWork.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
      expect(result.fixedPointIterations).toBeGreaterThan(1)
      expect(result.fixedPointIterations).toBeLessThanOrEqual(32)
      expect(result.persistenceRpcRequestBytes).toBe(
        utf8ByteLength(result.persistenceRpcRequestBody),
      )
      expect(persistenceObservation?.bodyBytes).toBe(
        result.persistenceRpcRequestBytes,
      )
      expect(accounting.memorySupplemental.canonicalJsonBytes).toBe(
        utf8ByteLength(result.accountingEvidence.accountingJson),
      )
      expect(result.checks).toEqual({
        sourceResponsesParsed: true,
        parentHashContinuity: true,
        portableNormalizationBuilt: true,
        persistenceRequestFixedPoint: true,
        noNetworkRequestIssued: true,
        noDatabaseRequestIssued: true,
        recoveryMutationCommitted: false,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('covers every G1 direction in one source-shaped shadow', async () => {
    const result = await runSupabaseRevision4OfflineShadow(readFixture())
    const observedBoundaries = new Set(
      result.accountingEvidence.accounting.observations.map(
        (observation) => observation.boundaryId,
      ),
    )

    expect(observedBoundaries).toEqual(
      new Set(Object.keys(SUPABASE_REVISION4_BYTE_BOUNDARIES)),
    )
    expect(
      result.accountingEvidence.accounting.directionalSummary.byBoundary.find(
        (row) => row.boundaryId === 'xrpl_to_edge_response',
      )?.rollingBillableEgressBytes,
    ).toBe(0)
    expect(
      result.accountingEvidence.accounting.directionalSummary.byBoundary.find(
        (row) => row.boundaryId === 'xrpl_to_edge_response',
      )?.memoryTransportBytes,
    ).toBeGreaterThan(0)
  })

  it('is deterministic for the same retained fixture', async () => {
    const first = await runSupabaseRevision4OfflineShadow(readFixture())
    const second = await runSupabaseRevision4OfflineShadow(readFixture())

    expect(second.accountingEvidence.accountingJson).toBe(
      first.accountingEvidence.accountingJson,
    )
    expect(second.accountingEvidence.accountingDigest).toBe(
      first.accountingEvidence.accountingDigest,
    )
    expect(second.persistenceRpcRequestBody).toBe(first.persistenceRpcRequestBody)
    expect(second.normalizedWork).toEqual(first.normalizedWork)
  })

  it('produces a writer-compatible RPC request without invoking it', async () => {
    const fixture = readFixture()
    const result = await runSupabaseRevision4OfflineShadow(fixture)
    const request = JSON.parse(result.persistenceRpcRequestBody) as Record<string, unknown>

    expect(request).toEqual({
      p_accounting_digest: result.accountingEvidence.accountingDigest,
      p_accounting_json: result.accountingEvidence.accountingJson,
      p_source_commit: fixture.sourceCommit,
      p_source_run_id: fixture.sourceRunId,
    })
    expect(result.checks.noDatabaseRequestIssued).toBe(true)
  })

  it('fails closed on broken parent-hash continuity', async () => {
    const fixture = readFixture()
    const second = JSON.parse(fixture.ledgers[1]!.responseBody) as {
      result: { ledger: { parent_hash: string } }
    }
    second.result.ledger.parent_hash = 'WRONG-PARENT'
    fixture.ledgers[1]!.responseBody = JSON.stringify(second)

    await expect(runSupabaseRevision4OfflineShadow(fixture)).rejects.toThrow(
      'parent hash mismatch',
    )
  })

  it('fails closed on invalid source identity and malformed response JSON', async () => {
    const invalidCommit = readFixture()
    invalidCommit.sourceCommit = 'not-a-commit'
    await expect(runSupabaseRevision4OfflineShadow(invalidCommit)).rejects.toThrow(
      'sourceCommit must be a 40-character lowercase SHA',
    )

    const malformed = readFixture()
    malformed.ledgers[0]!.responseBody = '{'
    await expect(runSupabaseRevision4OfflineShadow(malformed)).rejects.toThrow(
      'must be valid JSON',
    )
  })
})
