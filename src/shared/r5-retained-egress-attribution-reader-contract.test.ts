import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const diagnostic = readFileSync(
  resolve(
    process.cwd(),
    'scripts/diagnose-supabase-r5-retained-egress-attribution.mjs',
  ),
  'utf8',
)

describe('R5 retained attribution reader contract', () => {
  it('uses fields actually returned by the active recovery reader', () => {
    for (const required of [
      "reader.status === 'halted'",
      "reader.lastError === 'r5_recovery_monthly_egress_halt'",
      'reader.completedBatches',
      'reader.committedLedgers',
      'recoveryAttribution.fullReservationBatchCount === 0',
    ]) {
      expect(diagnostic).toContain(required)
    }
  })

  it('does not depend on non-existent active-work count fields', () => {
    expect(diagnostic).not.toContain('reader.activeBatchCount')
    expect(diagnostic).not.toContain('reader.noncommittedWorkCount')
  })
})
