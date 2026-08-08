import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const wrapper = read('scripts/verify-supabase-r5-first-recovery-batch.mjs')
const strict = read(
  'scripts/verify-supabase-r5-first-recovery-batch-strict.mjs',
)
const workflow = read(
  'ops/retired/supabase-remote-probe-r4c-r5-workflow.snapshot.yml',
)

const originalQueueGuard = `    || after.startedAt === null
    || after.checks.activeRecoveryStarted !== (after.status === 'running')
    || requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1
    || requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0
    || requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0
    || requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0
    || requiredInteger(`

const matureAwareQueueGuard = `    || after.startedAt === null
    || after.checks.activeRecoveryStarted !== (after.status === 'running')
    || (exactFirstBatchOnly && (
      requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1
      || requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0
      || requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0
      || requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0
    ))
    || requiredInteger(`

describe('R5 mature recovery first-batch verifier adapter', () => {
  it('retains the reviewed strict verifier source unchanged', () => {
    expect(strict).toContain('const exactFirstBatchOnly = after.completedBatches === 1')
    expect(strict).toContain(originalQueueGuard)
    expect(strict).toContain(
      'const recoveryDescendant = verifyRecoveryDescendant(',
    )
    expect(strict).toContain(
      "throw new Error('first R5 recovery batch exact watermark advance failed')",
    )
  })

  it('moves queue quiescence behind the exact first-batch condition only', () => {
    expect(wrapper).toContain(originalQueueGuard)
    expect(wrapper).toContain(matureAwareQueueGuard)
    expect(wrapper).toContain("'R5 mature recovery queue parity guard'")
    expect(wrapper).toContain('oldCount !== 1 || newCount !== 0')
    expect(wrapper).toContain('did not converge exactly')
  })

  it('retains the established historical workflow path as a non-executable contract snapshot', () => {
    expect(workflow).toContain(
      'run: node scripts/verify-supabase-r5-first-recovery-batch.mjs',
    )
    expect(workflow).toContain(
      "- 'scripts/verify-supabase-r5-first-recovery-batch.mjs'",
    )
    expect(workflow).toContain('RETIRED / NON-EXECUTABLE CONTRACT SNAPSHOT')
  })

  it('does not add mutation, deployment, Mainnet, stabilization or soak authority', () => {
    for (const forbidden of [
      'supabase db push',
      'supabase functions deploy',
      'SUPABASE_DB_PASSWORD',
      'SUPABASE_SERVICE_ROLE_KEY',
      "MAINNET_ENABLED: 'true'",
      'stabilizationAuthorized: true',
      'soakAuthorized: true',
    ]) {
      expect(wrapper).not.toContain(forbidden)
    }
  })
})
