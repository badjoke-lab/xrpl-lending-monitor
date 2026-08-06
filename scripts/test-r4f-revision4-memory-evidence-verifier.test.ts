import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it } from 'vitest'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('R4F revision-4 memory evidence verifier harness', () => {
  it(
    'stores synthetic output and fails closed when proof is required',
    () => {
      execFileSync(
        'bash',
        [resolve(rootDirectory, 'scripts/test-r4f-revision4-memory-evidence-verifier.sh')],
        {
          cwd: rootDirectory,
          stdio: 'pipe',
        },
      )
    },
    30_000,
  )
})
