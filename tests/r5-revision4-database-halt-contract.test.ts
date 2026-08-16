import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'ops/production-sql/20260816163000_xrpl_r5_revision4_database_halt_guard.sql',
  'utf8',
)

describe('R5 revision-4 database halt guard', () => {
  it('uses the fixed 400 MB project halt with an inclusive stop boundary', () => {
    expect(migration).toContain('select p_database_bytes < 400000000::bigint')
    expect(migration).toContain('database_claim_allowed(399999999::bigint) is not true')
    expect(migration).toContain('database_claim_allowed(400000000::bigint) is not false')
    expect(migration).toContain('database_claim_allowed(400000001::bigint) is not false')
  })

  it('halts before caught-up or leased-batch mutation and records measured headroom', () => {
    const measure = migration.indexOf(
      'v_database_bytes := pg_database_size(current_database())',
    )
    const caughtUp = migration.indexOf(
      'if p_validated_head_ledger_index < v_watermark.ledger_index then',
    )
    const leasedBatch = migration.indexOf('select * into v_existing')

    expect(measure).toBeGreaterThan(-1)
    expect(caughtUp).toBeGreaterThan(measure)
    expect(leasedBatch).toBeGreaterThan(measure)
    expect(migration).toContain("last_error = ''r5_recovery_database_halt''")
    expect(migration).toContain("''databaseBytes'', v_database_bytes")
    expect(migration).toContain("''databaseHaltBytes'', v_database_halt")
    expect(migration).toContain(
      "''databaseHeadroomBytes'', v_database_halt - v_database_bytes",
    )
  })

  it('patches only the live revision-4 claim under the existing R5 advisory lock', () => {
    expect(migration).toContain(
      "'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)'",
    )
    expect(migration).toContain("hashtextextended('xrpl-r5-active-recovery', 0)")
    expect(migration).not.toContain('xrpl_claim_r5_active_recovery_batch(text,text')
    expect(migration).not.toMatch(/delete\s+from/i)
    expect(migration).not.toMatch(/truncate/i)
    expect(migration).not.toMatch(/vacuum/i)
  })

  if (process.env.CI === 'true') {
    it(
      'applies the staged guard to a clone-shaped PostgreSQL claim and proves the boundary',
      () => {
        execFileSync('bash', ['scripts/test-r5-revision4-database-halt-postgres.sh'], {
          stdio: 'inherit',
          timeout: 120_000,
        })
      },
      130_000,
    )
  }
})
