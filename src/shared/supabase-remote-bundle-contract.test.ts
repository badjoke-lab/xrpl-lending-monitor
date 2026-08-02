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
  it('bundles both exact checked-out Edge entries before API deployment', () => {
    for (const required of [
      'Bundle exact Devnet phase executor and committed reader',
      'bundle_function() {',
      'local source_path="$1"',
      'local bundle_path="$2"',
      'local evidence_path="$3"',
      'bun build "$source_path"',
      '--target=browser',
      '--format=esm',
      "'supabase/functions/xrpl-collector-tick/index.ts'",
      "'/tmp/xrpl-collector-tick-index.ts'",
      '"$evidence_dir/bundle.json"',
      "'supabase/functions/xrpl-committed-reader/index.ts'",
      "'/tmp/xrpl-committed-reader-index.ts'",
      '"$evidence_dir/reader-bundle.json"',
      "const unresolvedRelativeImport = /(?:from\\s*|import\\s*\\()\\s*['\"]\\.{1,2}\\//u",
      "bundle.includes('cloudflare:')",
      "bundle.includes('Deno.serve')",
      'relativeImports: 0',
      'cloudflareImports: 0',
      'cp "$bundle_path" "$source_path"',
      'Deploy exact Devnet phase executor bundle',
      'supabase functions deploy xrpl-collector-tick',
      'Deploy qualification-only committed reader bundle',
      'supabase functions deploy xrpl-committed-reader',
      '--use-api',
      '--no-verify-jwt',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('retains sanitized bundle evidence without exposing Supabase secrets or the verifier token', () => {
    for (const required of [
      "'supabase-remote-probe-evidence/bundle.json'",
      "'supabase-remote-probe-evidence/reader-bundle.json'",
      "createHash('sha256').update(bundle).digest('hex')",
      'bundle bytes:',
      'bundle sha256:',
      'reader bundle bytes:',
      'reader bundle sha256:',
      'unresolved relative imports:',
      'Cloudflare runtime imports:',
      'retention-days: 7',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow).not.toContain('echo "$SUPABASE_ACCESS_TOKEN"')
    expect(workflow).not.toContain('echo "$SUPABASE_DB_PASSWORD"')
    expect(workflow).not.toContain('echo "$SUPABASE_PROJECT_ID"')
    expect(workflow).not.toContain('echo "$XRPL_READER_VERIFY_TOKEN"')
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

  it('redeploys when any bundled collector or reader dependency changes', () => {
    for (const required of [
      "- 'supabase/**'",
      "- 'src/collector/history-segments/**'",
      "- 'src/collector/incremental/**'",
      "- 'src/shared/portable-collector-*.ts'",
      "- 'scripts/verify-supabase-committed-reader.mjs'",
    ]) {
      expect(workflow).toContain(required)
    }
  })
})
