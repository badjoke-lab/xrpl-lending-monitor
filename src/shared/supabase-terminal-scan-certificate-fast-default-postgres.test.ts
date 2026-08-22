import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const scriptPath = resolve(
  process.cwd(),
  'scripts/test-r5-terminal-scan-certificate-fast-default-postgres.sh',
)
const script = readFileSync(scriptPath, 'utf8')

describe('terminal scan-certificate constant fast-default PostgreSQL proof', () => {
  it('is disposable-local only and models the exact proven historical row count', () => {
    expect(script).toContain("image='postgres:15-alpine'")
    expect(script).toContain('generate_series(1,17063)')
    expect(script).toContain('production migration created/applied: \\`false\\`')
    expect(script).not.toContain('SUPABASE_ACCESS_TOKEN')
    expect(script).not.toContain('SUPABASE_PROJECT_ID')
    expect(script).not.toContain('/database/query')
    expect(script).not.toContain('supabase/migrations/')
  })

  it('uses constant NOT NULL DEFAULT zero without historical UPDATE backfill', () => {
    expect(script).toContain(
      'add column source_scan_sequence integer not null default 0',
    )
    expect(script).toContain(
      'add column next_scan_sequence integer not null default 0',
    )
    expect(script).toContain("work_missing\" == 'true:{0}'")
    expect(script).toContain("stream_missing\" == 'true:{0}'")
    expect(script).not.toMatch(/update\s+public\.xrpl_phase_work_model\s+set\s+source_scan_sequence/iu)
  })

  it('pins no heap rewrite and preserves physical tuple identity', () => {
    for (const required of [
      'work_before_bytes',
      'work_after_bytes',
      'work_before_relfilenode',
      'work_after_relfilenode',
      'work_before_ctid_digest',
      'work_after_ctid_digest',
      'stream_before_bytes',
      'stream_after_bytes',
      'stream_before_ctid',
      'stream_after_ctid',
    ]) {
      expect(script).toContain(required)
    }
    expect(script).toContain('[[ "$work_before_bytes" == "$work_after_bytes" ]]')
    expect(script).toContain(
      '[[ "$work_before_relfilenode" == "$work_after_relfilenode" ]]',
    )
    expect(script).toContain(
      '[[ "$work_before_ctid_digest" == "$work_after_ctid_digest" ]]',
    )
  })

  it('allows future explicit nonzero values and rejects negatives', () => {
    expect(script).toContain("'future-work'")
    expect(script).toContain('source_scan_sequence) values')
    expect(script).toContain("[[ \"$future_value\" == '7' ]]")
    expect(script).toContain('exception when check_violation then')
    expect(script).toContain('set next_scan_sequence=-1')
  })

  it.runIf(Boolean(process.env.CI))(
    'runs the 17,063-row disposable PostgreSQL fast-default proof in CI',
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
