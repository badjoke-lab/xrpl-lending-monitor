import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-remote-probe.yml'),
  'utf8',
)

describe('Supabase remote prebundle contract', () => {
  it('bundles the exact checked-out Edge entry before API deployment', () => {
    for (const required of [
      'Bundle exact Devnet phase executor',
      "source_path='supabase/functions/xrpl-collector-tick/index.ts'",
      'bun build "$source_path"',
      '--target=browser',
      '--format=esm',
      "bundle_path='/tmp/xrpl-collector-tick-index.ts'",
      "const unresolvedRelativeImport = /(?:from\\s*|import\\s*\\()\\s*['\"]\\.{1,2}\\//u",
      "bundle.includes('Deno.serve')",
      "relativeImports: 0",
      'cp "$bundle_path" "$source_path"',
      'Deploy exact Devnet phase executor bundle',
      'supabase functions deploy xrpl-collector-tick',
      '--use-api',
      '--no-verify-jwt',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('retains sanitized bundle evidence without exposing Supabase secrets', () => {
    for (const required of [
      "'supabase-remote-probe-evidence/bundle.json'",
      "createHash('sha256').update(bundle).digest('hex')",
      'bundle bytes:',
      'bundle sha256:',
      'unresolved relative imports:',
      'retention-days: 7',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow).not.toContain('echo "$SUPABASE_ACCESS_TOKEN"')
    expect(workflow).not.toContain('echo "$SUPABASE_DB_PASSWORD"')
    expect(workflow).not.toContain('echo "$SUPABASE_PROJECT_ID"')
  })

  it('redeploys when any bundled collector dependency changes', () => {
    for (const required of [
      "- 'supabase/**'",
      "- 'src/collector/history-segments/**'",
      "- 'src/collector/incremental/**'",
      "- 'src/shared/portable-collector-*.ts'",
    ]) {
      expect(workflow).toContain(required)
    }
  })
})
