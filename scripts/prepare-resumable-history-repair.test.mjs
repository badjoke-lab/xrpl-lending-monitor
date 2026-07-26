import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { patchHistoryRepairRunner } from './prepare-resumable-history-repair.mjs'

describe('patchHistoryRepairRunner', () => {
  it('adds verified reuse and ten-segment candidate checkpoints to the fixed repair runner', async () => {
    const source = await readFile('scripts/run-history-repair-3932301.sh', 'utf8')
    const patched = patchHistoryRepairRunner(source)

    expect(patched).toContain('reusing verified segment ${ORDINAL}/263')
    expect(patched).toContain('Checkpoint immutable history repair through segment ${ORDINAL}')
    expect(patched).toContain('ORDINAL % 10 == 0 || ORDINAL == 263')
    expect(patched).toContain('sha256sum "$OUT/$FILE_PATH"')

    const root = await mkdtemp(join(tmpdir(), 'resumable-history-repair-'))
    const path = join(root, 'runner.sh')
    await writeFile(path, patched, 'utf8')
    execFileSync('bash', ['-n', path], { stdio: 'pipe' })
  })

  it('refuses to patch an unknown runner shape', () => {
    expect(() => patchHistoryRepairRunner('#!/usr/bin/env bash\n')).toThrow(
      'Missing resumable repair patch target: segment generation start',
    )
  })
})
