import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const scriptPath = resolve(
  process.cwd(),
  'scripts/test-r5-terminal-scan-certificate-storage-postgres.sh',
)
const script = readFileSync(scriptPath, 'utf8')

describe('bounded terminal scan-certificate PostgreSQL storage proof', () => {
  it('is isolated from production and models only two integer certificate fields', () => {
    expect(script).toContain('source_scan_sequence integer')
    expect(script).toContain('next_scan_sequence integer')
    expect(script).toContain('append-only certificate table required: `false`')
    expect(script).toContain('production database used: `false`')
    expect(script).toContain('production migration created/applied: `false`')
    expect(script).not.toContain('SUPABASE_ACCESS_TOKEN')
    expect(script).not.toContain('SUPABASE_PROJECT_ID')
    expect(script).not.toContain('/database/query')
    expect(script).not.toContain('supabase/migrations/')
  })

  it('pins metadata-only column addition, exact-500 backfill, and ordinary-VACUUM reuse checks', () => {
    for (const required of [
      'work_after_add_relfilenode',
      'stream_after_add_relfilenode',
      'generate_series(1,500)',
      'alter column source_scan_sequence set not null',
      'alter column next_scan_sequence set not null',
      'for i in 1..5000 loop',
      'vacuum public.xrpl_phase_streams_model',
      'stream_after_cycle2_bytes',
      'VACUUM FULL required for reuse proof: `false`',
    ]) {
      expect(script).toContain(required)
    }
    expect(script).not.toMatch(/^\s*vacuum\s+full\b/imu)
  })

  it.runIf(Boolean(process.env.CI))(
    'runs the disposable PostgreSQL measurement in CI',
    () => {
      execFileSync('bash', [scriptPath], {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 120_000,
      })
    },
    130_000,
  )
})
