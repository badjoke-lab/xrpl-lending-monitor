import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'scripts/r5-terminal-transport-rewrite-readonly-preflight.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-index-footprint-readonly-probe.yml'),
  'utf8',
)

describe('R5 terminal transport rewrite read-only preflight', () => {
  it('uses only the Supabase read-only management query surface', () => {
    expect(source).toContain('body: JSON.stringify({ query: SQL, read_only: true })')
    expect(source).toContain('rewrite preflight SQL contains forbidden mutation capability')
    expect(source).toContain("if (!/^\\s*with\\b/iu.test(SQL))")
  })

  it('binds the model to the current 400MB halt and qualified R5 reserve', () => {
    expect(source).toContain('const DATABASE_HALT_BYTES = 400_000_000')
    expect(source).toContain('const CAPACITY_RESERVE_BYTES = 122_420_032')
    expect(source).toContain('const CAPACITY_FINAL_DATABASE_MAX_BYTES = DATABASE_HALT_BYTES - CAPACITY_RESERVE_BYTES')
    expect(source).toContain('requiredReclaimBytes')
    expect(source).toContain('finalCapacityReserveSafe')
  })

  it('models archive growth and sequential rewrite peaks conservatively', () => {
    expect(source).toContain('Math.max(projectedArchiveGrowthByRows, projectedArchiveGrowthByTuple)')
    expect(source).toContain('Math.max(compactMessagesUpperBytes, compactSuccessorsUpperBytes)')
    expect(source).toContain('projectedArchivePhasePeakBytes')
    expect(source).toContain('projectedSequentialRewritePeakBytes')
    expect(source).toContain('archivePhaseFitsHalt')
    expect(source).toContain('sequentialRewriteFitsHalt')
  })

  it('keeps every production mutation unauthorized', () => {
    for (const guard of [
      'productionDatabaseReadOnly: true',
      'measurementOnly: true',
      'phaseBDeleteAuthorized: false',
      'archiveMutationAuthorized: false',
      'physicalRewriteAuthorized: false',
      'vacuumAuthorized: false',
      'schedulerMutationAuthorized: false',
      'deploymentAuthorized: false',
      'publicReaderMutationAuthorized: false',
      'r5RearmAuthorized: false',
      'mainnetDisabled: true',
    ]) {
      expect(source).toContain(guard)
    }
  })

  it('runs only inside the existing exact-owner read-only footprint workflow', () => {
    expect(workflow).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(workflow).toContain("github.event.comment.body == '/r5-index-footprint-readonly-probe'")
    expect(workflow).toContain('Model terminal transport rewrite headroom only')
    expect(workflow).toContain('node scripts/r5-terminal-transport-rewrite-readonly-preflight.mjs')
    expect(workflow).toContain('terminal-transport-rewrite-preflight-summary.md')
    expect(workflow).not.toMatch(/\n\s*execute:\s*\n/u)
    expect(workflow).not.toContain('read_only: false')
  })
})
