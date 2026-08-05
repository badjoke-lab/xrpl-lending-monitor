import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

describe('R5 generated preclaim controller', () => {
  it('applies both adapter layers and produces valid generated verifier syntax', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/run-supabase-r5-recovery-burst-contention-aware.mjs'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          R5_RECOVERY_ADAPTER_VALIDATE_ONLY: '1',
        },
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.signal).toBeNull()
  })
})
