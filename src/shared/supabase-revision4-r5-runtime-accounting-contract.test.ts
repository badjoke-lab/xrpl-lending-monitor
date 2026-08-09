import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const runtime = read('src/shared/supabase-revision4-r5-runtime-accounting.ts')
const executor = read('supabase/functions/xrpl-r5-recovery-batch/index.ts')

describe('revision-4 R5 runtime-accounting integration boundary', () => {
  it('contains the directional runtime model and does not weaken the 12-ledger claim cap', () => {
    expect(runtime).toContain('selectedMaximumLedgersPerClaim: 12')
    expect(runtime).toContain("boundaryId: 'xrpl_to_edge_response'")
    expect(runtime).toContain("boundaryId: 'edge_to_xrpl_request'")
    expect(runtime).toContain("boundaryId: 'edge_to_invoker_response'")
  })

  it('keeps the current revision-3 executor visibly unconverted until the wiring commit lands', () => {
    expect(executor).toContain('evaluateSupabaseRevision3ResourceAccounting')
    expect(executor).toContain('FUNCTION_RESPONSE_RESERVE_BYTES = 128 * 1024')
    expect(executor).toContain('COMPLETION_REQUEST_RESERVE_BYTES = 2 * 1024 * 1024')
  })
})
