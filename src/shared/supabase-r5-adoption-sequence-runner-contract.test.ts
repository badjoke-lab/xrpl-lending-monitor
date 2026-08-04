import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const runner = read(
  'scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
)
const workflow = read('.github/workflows/r5-bounded-recovery-burst.yml')

describe('R5 adoption sequence correction runner', () => {
  it('replaces exactly the obsolete record-count sequence expectation', () => {
    for (const required of [
      "const sourcePath = 'scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs'",
      'afterAdoptions.adoptionCount',
      'beforeAdoptions.adoptedBatchCount + 1',
      'source.split(obsolete).length - 1',
      'occurrenceCount !== 1',
      'source.replace(obsolete, corrected)',
      'generated.includes(obsolete)',
      '!generated.includes(corrected)',
    ]) {
      expect(runner).toContain(required)
    }
  })

  it('executes only a private generated copy and always removes it', () => {
    for (const required of [
      '/tmp/xrpl-r5-recovery-burst-adoption-aware-${process.pid}.mjs',
      "mode: 0o600",
      'await import(pathToFileURL(generatedPath).href)',
      'await rm(generatedPath, { force: true })',
    ]) {
      expect(runner).toContain(required)
    }
  })

  it('keeps the existing owner-only finite workflow bounds', () => {
    expect(workflow).toContain(
      'node scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
    )
    expect(workflow).toContain("github.actor == 'badjoke-lab'")
    expect(workflow).toContain(
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    )
    expect(workflow).toContain('test "$R5_RECOVERY_BURST_BATCH_LIMIT" -le 64')
    expect(workflow).toContain('test "$R5_RECOVERY_BURST_WALL_SECONDS" -le 1800')
  })
})
