import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const qualifier = readFileSync(
  resolve(process.cwd(), 'scripts/qualify-r5-free-operation-capacity.mjs'),
  'utf8',
)

describe('R5 free-operation capacity growth model', () => {
  it('reconstructs generated raw rows even after raw retention prunes old chunks', () => {
    expect(qualifier).toContain('expected_payload_chunks')
    expect(qualifier).toContain('expected_commit_chunks')
    expect(qualifier).toContain('generatedRawRowsReconstructedFromWorkExpectations: true')
    expect(qualifier).toContain("method: 'retention_aware_generated_rows_times_persistent_physical_amplification'")
  })

  it('measures detoasted logical row values instead of projecting tiny-table fixed allocation per retained row', () => {
    expect(qualifier).toContain('pg_column_size(to_jsonb(t))')
    expect(qualifier).not.toContain('pg_column_size(t)')
    expect(qualifier).toContain('persistentPhysicalAmplificationFactor')
    expect(qualifier).toContain("where retention_class='persistent'")
    expect(qualifier).not.toContain('last_14_committed_ledgers_max_direct_rows_x2_plus_transport_overhead_physical_row_upper_bound')
  })

  it('counts the full reserve horizon and requires the exact active raw-retention contract without authorizing mutation', () => {
    expect(qualifier).toContain('const RESERVE_WINDOWS = 14')
    expect(qualifier).toContain('projectedIncrementalDatabaseBytes * RESERVE_WINDOWS')
    expect(qualifier).toContain("const RAW_JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'")
    expect(qualifier).toContain("const RAW_JOB_SCHEDULE = '47 */6 * * *'")
    expect(qualifier).toContain("const RAW_JOB_COMMAND_SHA256 = 'a7029e464b56f7652b7690b6a8f5b90331d5dfbb0812e3a0ab2788987c64ec98'")
    expect(qualifier).toContain('rawRetentionExactContract')
    expect(qualifier).toContain('rawRetentionLagWithinCadence')
    expect(qualifier).toContain('productionDatabaseReadOnly: true')
    expect(qualifier).toContain('rowMutationPerformed: false')
    expect(qualifier).toContain('schedulerMutationPerformed: false')
    expect(qualifier).toContain('r5RearmAuthorized: false')
    expect(qualifier).toContain('mainnetEnabled: false')
  })
})
