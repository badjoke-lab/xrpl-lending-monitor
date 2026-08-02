import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-remote-probe.yml'),
  'utf8',
)
const parserSurface = readFileSync(
  resolve(process.cwd(), 'src/collector/incremental/read-validated-ledger.ts'),
  'utf8',
)
const parser = readFileSync(
  resolve(process.cwd(), 'src/collector/incremental/validated-ledger-parser.ts'),
  'utf8',
)
const rpcReader = readFileSync(
  resolve(process.cwd(), 'src/collector/incremental/read-validated-ledger-rpc.ts'),
  'utf8',
)
const edgeFunction = readFileSync(
  resolve(process.cwd(), 'supabase/functions/xrpl-collector-tick/index.ts'),
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
      "bundle.includes('cloudflare:')",
      "bundle.includes('Deno.serve')",
      'relativeImports: 0',
      'cloudflareImports: 0',
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
      'Cloudflare runtime imports:',
      'retention-days: 7',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow).not.toContain('echo "$SUPABASE_ACCESS_TOKEN"')
    expect(workflow).not.toContain('echo "$SUPABASE_DB_PASSWORD"')
    expect(workflow).not.toContain('echo "$SUPABASE_PROJECT_ID"')
  })

  it('keeps the Edge parser surface independent from the Cloudflare RPC transport', () => {
    expect(edgeFunction).toContain(
      "from '../../../src/collector/incremental/read-validated-ledger.ts'",
    )
    expect(parserSurface).toContain("from './validated-ledger-parser'")
    expect(parserSurface).not.toContain('xrpl-rpc')
    expect(parserSurface).not.toContain('readValidatedLedger(')
    expect(parser).toContain('export function parseValidatedLedgerResult')
    expect(parser).not.toContain('xrpl-rpc')
    expect(parser).not.toContain('cloudflare:')
    expect(rpcReader).toContain("from '../network/xrpl-rpc'")
    expect(rpcReader).toContain('export async function readValidatedLedger')
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
