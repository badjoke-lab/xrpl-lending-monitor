import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const activeR5Executor = readFileSync(
  resolve(
    process.cwd(),
    'supabase/functions/xrpl-r5-recovery-batch/index.ts',
  ),
  'utf8',
)
const activeR5Trigger = readFileSync(
  resolve(
    process.cwd(),
    'supabase/functions/xrpl-r5-recovery-batch-trigger/index.ts',
  ),
  'utf8',
)

describe('revision-4 G2 meter isolation', () => {
  it('does not wire the unselected candidate into the active revision-3 executor', () => {
    expect(activeR5Executor).not.toContain(
      'supabase-revision4-directional-meter',
    )
    expect(activeR5Executor).not.toContain(
      'SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST',
    )
    expect(activeR5Trigger).not.toContain(
      'SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST',
    )
  })

  it('keeps the active executor bound to revision 3', () => {
    expect(activeR5Executor).toContain(
      'evaluateSupabaseRevision3ResourceAccounting',
    )
    expect(activeR5Executor).toContain(
      'SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST',
    )
    expect(activeR5Executor).toContain(
      "const RECOVERY_RUN_ID = 'r5-recovery-selected-revision3-entry'",
    )
  })
})
