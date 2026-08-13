import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildSupabaseRevision4DirectionalAccountingEvidence,
  type SupabaseRevision4DirectionalAccountingInput,
} from './supabase-revision4-directional-meter'
import { SUPABASE_REVISION4_BYTE_BOUNDARIES } from './supabase-revision4-directional-egress-contract'

function readFixture(): SupabaseRevision4DirectionalAccountingInput {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'ops/r4f/revision4-directional-meter-fixture.json',
      ),
      'utf8',
    ),
  ) as SupabaseRevision4DirectionalAccountingInput
}

describe('revision-4 directional meter fixture', () => {
  it('covers every G1 byte boundary exactly once', () => {
    const fixture = readFixture()
    const boundaryIds = fixture.observations.map((observation) => observation.boundaryId)

    expect(new Set(boundaryIds)).toEqual(
      new Set(Object.keys(SUPABASE_REVISION4_BYTE_BOUNDARIES)),
    )
    expect(boundaryIds).toHaveLength(
      Object.keys(SUPABASE_REVISION4_BYTE_BOUNDARIES).length,
    )
  })

  it('builds canonical retained evidence without authorizing recovery', async () => {
    const evidence = await buildSupabaseRevision4DirectionalAccountingEvidence(
      readFixture(),
    )

    expect(evidence.accounting.observations).toHaveLength(8)
    expect(evidence.accounting.rollingBillableEgressUpperBoundBytes).toBe(8_506)
    expect(evidence.accounting.memoryTransportUpperBoundBytes).toBe(79_354)
    expect(evidence.accounting.disposition).toBe('shadow_completed')
    expect(evidence.accounting.checks.recoveryMutationCommitted).toBe(false)
    expect(evidence.accounting.checks.publicReaderUnchanged).toBe(true)
    expect(evidence.accounting.checks.mainnetDisabled).toBe(true)
    expect(evidence.accountingJson).toContain('xrpl_to_edge_response')
    expect(evidence.accountingDigest).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('keeps inbound and same-project database bytes in memory while excluding them from rolling egress', async () => {
    const evidence = await buildSupabaseRevision4DirectionalAccountingEvidence(
      readFixture(),
    )
    const inboundXrpl = evidence.accounting.directionalSummary.byBoundary.find(
      (row) => row.boundaryId === 'xrpl_to_edge_response',
    )
    const databaseRequest = evidence.accounting.directionalSummary.byBoundary.find(
      (row) => row.boundaryId === 'edge_to_database_request',
    )
    const databaseResponse = evidence.accounting.directionalSummary.byBoundary.find(
      (row) => row.boundaryId === 'database_to_edge_response',
    )

    expect(inboundXrpl).toEqual({
      boundaryId: 'xrpl_to_edge_response',
      totalBytes: 9_216,
      rollingBillableEgressBytes: 0,
      memoryTransportBytes: 9_216,
    })
    expect(databaseRequest).toMatchObject({
      totalBytes: 896,
      rollingBillableEgressBytes: 0,
      memoryTransportBytes: 896,
    })
    expect(databaseResponse).toMatchObject({
      totalBytes: 3_072,
      rollingBillableEgressBytes: 0,
      memoryTransportBytes: 3_072,
    })
  })
})