import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const runnerPath = resolve(
  process.cwd(),
  'scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
)
const runner = read(
  'scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
)
const workflow = read('.github/workflows/r5-bounded-recovery-burst.yml')

describe('R5 adoption-aware source correction runner', () => {
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

  it('requires every executor-budget correction exactly once', () => {
    for (const required of [
      'function occurrenceCountOf(text, fragment)',
      "throw new Error('R5 replacement fragment must not be empty')",
      'function replaceExactlyOnce(name, oldText, newText)',
      'occurrenceCountOf(generated, oldText)',
      'count !== 1',
      'generated.includes(newText)',
      'expectedRetainedOldCount = occurrenceCountOf(newText, oldText)',
      'occurrenceCountOf(next, newText) !== 1',
      'occurrenceCountOf(next, oldText) !== expectedRetainedOldCount',
      "'R5 executor-only cycle boundary'",
      "'R5 executor batch counter declaration'",
      "'R5 executor batch counter assignment'",
      "'R5 executor batch remaining-budget guard'",
      "'R5 non-adoption executor batch assignment'",
      "'R5 cycle executor count result'",
      "'R5 burst executor counter initialization'",
      "'R5 remaining executor budget'",
      "'R5 accumulated executor budget'",
      "'R5 cycle executor evidence'",
      "'R5 final executor budget guard'",
      "'R5 executor and materialized batch evidence'",
      "'R5 bounded executor evidence check'",
    ]) {
      expect(runner).toContain(required)
    }
  })

  it('accepts an exact replacement that intentionally retains its matched prefix', () => {
    const oldGuard = `      || adoptedBatchCount < 1
      || ![0, 1].includes(executorBatchCount)`
    const newGuard = `${oldGuard}
      || executorBatchCount > remainingLimit`

    expect(newGuard).toContain(oldGuard)
    expect(runner).toContain(oldGuard)
    expect(runner).toContain(newGuard)
    expect(runner).toContain(
      'expectedRetainedOldCount = occurrenceCountOf(newText, oldText)',
    )
  })

  it('binds executor evidence fields to the unique success-evidence context', () => {
    expect(runner).toContain(
      `    requestedBatchLimit: batchLimit,
    wallSeconds,
    elapsedMilliseconds: Date.now() - startedAtMilliseconds,`,
    )
    expect(runner).toContain(
      `    requestedBatchLimit: batchLimit,
    requestedExecutorBatchLimit: batchLimit,
    executedRecoveryBatches: executedBatchCount,
    materializedBatchRows: batches.length,
    wallSeconds,
    elapsedMilliseconds: Date.now() - startedAtMilliseconds,`,
    )
  })

  it('preflights the complete generated controller without production access', () => {
    expect(() =>
      execFileSync(process.execPath, [runnerPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          R5_RECOVERY_ADAPTER_VALIDATE_ONLY: '1',
        },
        stdio: 'pipe',
      }),
    ).not.toThrow()

    for (const required of [
      "process.env.R5_RECOVERY_ADAPTER_VALIDATE_ONLY === '1'",
      "spawnSync(process.execPath, ['--check', generatedPath]",
      'syntaxCheck.error || syntaxCheck.status !== 0',
      'R5 generated controller syntax validation failed',
    ]) {
      expect(runner).toContain(required)
    }
  })

  it('charges the finite run limit only to newly executed recovery batches', () => {
    for (const required of [
      'let executorBatchCount = 0',
      'executorBatchCount = advancedBatches - adoptedBatchCount',
      'executorBatchCount > remainingLimit',
      'executorBatchCount = 1',
      'let executedBatchCount = 0',
      'while (executedBatchCount < batchLimit)',
      'const remainingLimit = batchLimit - executedBatchCount',
      'executedBatchCount += result.cycle.executorBatchCount',
      'executedBatchCount > batchLimit',
    ]) {
      expect(runner).toContain(required)
    }
    expect(runner).toContain(
      `    advancedBatches < 0
    || advancedLedgers < 0
    || ![0, 1].includes(addedAdoptions)`,
    )
  })

  it('retains complete adoption-row verification and makes the accounting visible', () => {
    for (const required of [
      'requestedExecutorBatchLimit: batchLimit',
      'executedRecoveryBatches: executedBatchCount',
      'materializedBatchRows: batches.length',
      'boundedBatchLimit: batchLimit <= 64 && executedBatchCount <= batchLimit',
      'adoptionRowsExcludedFromExecutorBudget',
      "batch.origin === 'adopted_active_descendant'",
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
