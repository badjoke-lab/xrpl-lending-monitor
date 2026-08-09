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
  it('allows code-only R5 rev4 wiring without treating the G2 shadow meter as live authorization', () => {
    expect(activeR5Executor).toContain('supabase-revision4-r5-runtime-accounting')
    expect(activeR5Executor).toContain('SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST')
    expect(activeR5Executor).toContain("env('XRPL_R5_REVISION4_SELECTION_DIGEST')")
    expect(activeR5Executor).toContain(
      "env('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')",
    )
    expect(activeR5Executor).not.toContain("const SELECTION_DIGEST = '")
  })

  it('keeps the currently deployed trigger boundary fail-closed while rev4 DB wiring is repository-only', () => {
    expect(activeR5Trigger).not.toContain(
      'SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST',
    )
    expect(activeR5Trigger).toContain(
      "const RECOVERY_RUN_ID = 'r5-recovery-selected-revision3-entry'",
    )
    expect(activeR5Executor).toContain(
      "const RECOVERY_RUN_ID = 'r5-recovery-selected-revision4-entry'",
    )
  })
})
