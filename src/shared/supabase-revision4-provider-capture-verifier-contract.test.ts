import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Supabase revision-4 provider capture verifier isolation', () => {
  it('remains an offline file-to-file verifier with no provider capability', () => {
    const script = readFileSync(
      resolve(
        process.cwd(),
        'scripts/verify-r4f-revision4-provider-capture.ts',
      ),
      'utf8',
    )
    const config = readFileSync(
      resolve(
        process.cwd(),
        'vite.r4f-revision4-provider-capture-verifier.config.ts',
      ),
      'utf8',
    )

    expect(script).toContain('buildSupabaseRevision4ProviderCaptureEvidence')
    expect(script).toContain("argument('--input')")
    expect(script).toContain("argument('--output')")
    expect(script).toContain("process.argv.includes('--require-qualified')")
    expect(script).toContain('process.exitCode = 2')
    expect(config).toContain("ssr: 'scripts/verify-r4f-revision4-provider-capture.ts'")

    for (const forbidden of [
      'fetch(',
      'WebSocket',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_DB_PASSWORD',
      'api.supabase.com',
      'supabase db',
      'supabase functions',
      'gh issue comment',
      'xrpl_r5_v1',
    ]) {
      expect(script).not.toContain(forbidden)
      expect(config).not.toContain(forbidden)
    }
  })
})
