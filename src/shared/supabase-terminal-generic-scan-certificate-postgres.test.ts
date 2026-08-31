import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const stagedPath = resolve(
  process.cwd(),
  'ops/production-sql/20260823045000_xrpl_terminal_generic_scan_certificate_runtime.sql',
)
const staged = readFileSync(stagedPath, 'utf8')

function runDisposablePostgresProof(): string {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return execFileSync(
        'bash',
        [resolve(process.cwd(), 'scripts/test-r5-terminal-generic-scan-certificate-postgres.sh')],
        { encoding: 'utf8' },
      )
    } catch (error) {
      lastError = error
      if (attempt < 3) execFileSync('sleep', ['1'])
    }
  }
  throw lastError
}

describe('generic terminal scan certificate staging', () => {
  it('is an ops-only transactional staging patch', () => {
    expect(staged.trimStart().startsWith('begin;')).toBe(true)
    expect(staged.trimEnd().endsWith('commit;')).toBe(true)
    expect(staged).toContain('Merge does not apply this file')
    expect(staged).toContain('Issue #1261 prepare -> exact OWNER authorization -> bounded apply -> independent read-only verify')
    expect(staged).not.toContain('supabase/migrations/')
  })

  it('requires the previously staged portable certificate runtime first', () => {
    expect(staged).toContain('source_scan_sequence')
    expect(staged).toContain('next_scan_sequence')
    expect(staged).toContain('5e9cb3bfea6126c1d436ffb15fee5e8aaf6f2da3e0f83bf048d9cbdcf35040b0')
    expect(staged).toContain('daf97c6858300a2ec4a00eb24f60b53936dc4aa56200accc16e098c64e8f37b7')
    expect(staged).toContain('generic_scan_certificate_requires_terminal_certificate_columns')
  })

  it('pins exact current signatures and transformed generic definitions', () => {
    expect(staged).toContain('public.xrpl_complete_scan_phase(text,text,timestamp with time zone,bigint,text,text,bigint,text,text,integer)')
    expect(staged).toContain('cd6b05ccd95eb29bfa046d29cfd01236371301865ceef7bb8db3fd2afadd6bff')
    expect(staged).toContain('907e4c741ba065ffcb2ddd0a7358f83737c737673ca1fa6d371710f96e5a62ff')
    expect(staged).toContain('d3051c3b654274f7e6fa222be829b42829c6695c39a09c697065093364a6ff35')
    expect(staged).toContain('cfbc2dde88dc7026621193d2b970a1fdd35b7f9f7a248a7ef0035f1f87cae446')
    expect(staged).toContain('run 32618515092')
    expect(staged).toContain('c22c72753212eba91aab4e85c9b3ad5b2858e5a8')
  })

  it('makes generic scan and finalize obey the same certificate invariant', () => {
    expect(staged).toContain("v_message.payload->>'scanSequence' !~ '^(0|[1-9][0-9]*)$'")
    expect(staged).toContain("(v_message.payload->>'scanSequence')::integer <> v_stream.next_scan_sequence")
    expect(staged).toContain('source_scan_sequence,')
    expect(staged).toContain('v_stream.next_scan_sequence,')
    expect(staged).toContain('source_scan_sequence = v_stream.next_scan_sequence')
    expect(staged).toContain('v_stream.next_scan_sequence <> v_work.source_scan_sequence')
    expect(staged).toContain('set next_scan_sequence = 0')
    expect(staged).toContain('and next_scan_sequence = v_work.source_scan_sequence')
  })

  it('does not backfill historical work or alter scheduler/public reader/R5 state', () => {
    expect(staged).not.toMatch(/update\s+public\.xrpl_phase_work\s+set\s+source_scan_sequence/iu)
    expect(staged).not.toMatch(/\b(delete|truncate|vacuum|reindex)\b/iu)
    expect(staged).not.toContain('xrpl_r5_v1.recovery_runs')
    expect(staged).not.toContain('wrangler')
  })

  it('runs the disposable PostgreSQL transition proof', () => {
    const output = runDisposablePostgresProof()
    expect(output).toContain('exact active scan sequence persisted into generic work: `true`')
    expect(output).toContain('stale generic scan rejects without work/stream mutation: `true`')
    expect(output).toContain('generic finalize verifies work certificate and resets sequence to zero: `true`')
    expect(output).toContain('mismatched generic finalize rejects without work/stream mutation: `true`')
    expect(output).toContain('production SQL applied: `false`')
  })
})
