import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = process.cwd()
const PROOF_ENTRY = resolve(
  REPOSITORY_ROOT,
  'supabase/functions/xrpl-r4f-revision4-proof-batch/index.ts',
)
const SELECTION_DIGEST = '99a1f97fc17ed6023bc3075bffe963a260e99a4ed0e2d831b068826c7797222f'

describe('revision-4 qualification proof bundle', () => {
  it('prebundles the exact proof entry into one Supabase-compatible Edge source', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'xrpl-r4f-proof-bundle-'))
    const outputPath = join(outputDirectory, 'index.ts')
    try {
      const result = spawnSync(
        'bun',
        [
          'build',
          PROOF_ENTRY,
          '--target=browser',
          '--format=esm',
          `--outfile=${outputPath}`,
        ],
        {
          cwd: REPOSITORY_ROOT,
          encoding: 'utf8',
        },
      )
      if (result.error) throw result.error
      if (result.status !== 0) {
        throw new Error(
          `bun proof prebundle failed with status ${String(result.status)}\n${result.stdout}\n${result.stderr}`,
        )
      }

      const bundle = readFileSync(outputPath, 'utf8')
      const unresolvedRelativeImport = /(?:from\s*|import\s*\()\s*['"]\.{1,2}\//u
      expect(unresolvedRelativeImport.test(bundle)).toBe(false)
      expect(bundle).not.toContain('cloudflare:')
      expect(bundle).toContain('Deno.serve')
      expect(bundle).toContain(SELECTION_DIGEST)
      expect(bundle).toContain('r5-recovery-selected-revision4-entry')
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
  })
})
