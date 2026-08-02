import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const workflow = read('.github/workflows/supabase-remote-probe.yml')
const publisher = read('scripts/publish-supabase-run-locator.mjs')
const parserSurface = read('src/collector/incremental/read-validated-ledger.ts')
const parser = read('src/collector/incremental/validated-ledger-parser.ts')
const rpcReader = read('src/collector/incremental/read-validated-ledger-rpc.ts')
const edgeFunction = read('supabase/functions/xrpl-collector-tick/index.ts')

describe('Supabase remote prebundle contract', () => {
  it('bundles all eight exact checked-out Edge entries before API deployment', () => {
    for (const required of [
      'Bundle exact Devnet executors and qualification readers',
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
      "'supabase/functions/xrpl-historical-witness/index.ts'",
      "'/tmp/xrpl-historical-witness-index.ts'",
      '"$evidence_dir/historical-loader-bundle.json"',
      "'supabase/functions/xrpl-historical-witness-reader/index.ts'",
      "'/tmp/xrpl-historical-witness-reader-index.ts'",
      '"$evidence_dir/historical-reader-bundle.json"',
      "'supabase/functions/xrpl-multichunk-witness/index.ts'",
      "'/tmp/xrpl-multichunk-witness-index.ts'",
      '"$evidence_dir/multichunk-executor-bundle.json"',
      "'supabase/functions/xrpl-multichunk-witness-reader/index.ts'",
      "'/tmp/xrpl-multichunk-witness-reader-index.ts'",
      '"$evidence_dir/multichunk-reader-bundle.json"',
      "'supabase/functions/xrpl-complete-state-transfer/index.ts'",
      "'/tmp/xrpl-complete-state-transfer-index.ts'",
      '"$evidence_dir/complete-state-transfer-bundle.json"',
      "'supabase/functions/xrpl-restore-continuation/index.ts'",
      "'/tmp/xrpl-restore-continuation-index.ts'",
      '"$evidence_dir/restore-continuation-bundle.json"',
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
      'Deploy isolated historical witness loader bundle',
      'supabase functions deploy xrpl-historical-witness',
      'Deploy isolated historical witness reader bundle',
      'supabase functions deploy xrpl-historical-witness-reader',
      'Deploy isolated standard-phase multi-chunk executor bundle',
      'supabase functions deploy xrpl-multichunk-witness',
      'Deploy isolated standard-phase multi-chunk reader bundle',
      'supabase functions deploy xrpl-multichunk-witness-reader',
      'Deploy isolated complete-state transfer bundle',
      'supabase functions deploy xrpl-complete-state-transfer',
      'Deploy isolated post-restore continuation bundle',
      'supabase functions deploy xrpl-restore-continuation',
      'Verify isolated standard-phase multi-chunk execution and reader',
      'node scripts/verify-supabase-multichunk-witness.mjs',
      'Verify isolated complete-state export and typed restore',
      'node scripts/verify-supabase-complete-state-transfer.mjs',
      'Verify isolated post-restore continuation',
      'node scripts/verify-supabase-restore-continuation.mjs',
      '--use-api',
      '--no-verify-jwt',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('retains sanitized bundle evidence through the extracted locator publisher', () => {
    for (const required of [
      "['collector bundle', 'bundle.json']",
      "['committed reader bundle', 'reader-bundle.json']",
      "['historical loader bundle', 'historical-loader-bundle.json']",
      "['historical reader bundle', 'historical-reader-bundle.json']",
      "['multi-chunk executor bundle', 'multichunk-executor-bundle.json']",
      "['multi-chunk reader bundle', 'multichunk-reader-bundle.json']",
      "['complete-state transfer bundle', 'complete-state-transfer-bundle.json']",
      "['restore continuation bundle', 'restore-continuation-bundle.json']",
      "successFile: 'verified-multichunk-witness.json'",
      "failureFile: 'failed-multichunk-witness-verification.json'",
      "successFile: 'verified-complete-state-transfer.json'",
      "failureFile: 'failed-complete-state-transfer-verification.json'",
      "successFile: 'verified-restore-continuation.json'",
      "failureFile: 'failed-restore-continuation-verification.json'",
      '`- ${label} bytes: \\`${String(value.bytes ?? \'unknown\')}\\``',
      '`- ${label} sha256: \\`${String(value.sha256 ?? \'unknown\')}\\``',
      '`- ${label} relative imports: \\`${String(value.relativeImports ?? \'unknown\')}\\``',
      '`- ${label} Cloudflare imports: \\`${String(value.cloudflareImports ?? \'unknown\')}\\``',
    ]) {
      expect(publisher).toContain(required)
    }
    expect(workflow).toContain("createHash('sha256').update(bundle).digest('hex')")
    expect(workflow).toContain('retention-days: 7')
    const combined = `${workflow}\n${publisher}`
    expect(combined).not.toContain('echo "$SUPABASE_ACCESS_TOKEN"')
    expect(combined).not.toContain('echo "$SUPABASE_DB_PASSWORD"')
    expect(combined).not.toContain('echo "$SUPABASE_PROJECT_ID"')
    expect(combined).not.toContain('echo "$XRPL_READER_VERIFY_TOKEN"')
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

  it('redeploys when any bundled collector, reader, or verifier dependency changes', () => {
    for (const required of [
      "- 'supabase/**'",
      "- 'src/collector/history-segments/**'",
      "- 'src/collector/incremental/**'",
      "- 'src/shared/portable-collector-*.ts'",
      "- 'scripts/verify-supabase-committed-reader.mjs'",
      "- 'scripts/verify-supabase-historical-witness.mjs'",
      "- 'scripts/verify-supabase-multichunk-witness.mjs'",
      "- 'scripts/verify-supabase-complete-state-transfer.mjs'",
      "- 'scripts/verify-supabase-restore-continuation.mjs'",
      "- 'scripts/publish-supabase-run-locator.mjs'",
    ]) {
      expect(workflow).toContain(required)
    }
  })
})
