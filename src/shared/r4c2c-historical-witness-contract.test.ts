import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('R4C2c Devnet historical witness contract', () => {
  const runner = read('scripts/qualify-devnet-historical-witness.ts')
  const workflow = read('.github/workflows/r4c2c-devnet-historical-witness.yml')
  const allowlist = read('scripts/check-actions-workflow-allowlist.sh')

  it('uses immutable audit-derived Devnet ledger inputs and the canonical seven-class normalizer', () => {
    for (const required of [
      "const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234/'",
      'const AUDIT_WINDOW_START = 3_269_937',
      'const AUDIT_WINDOW_END = 3_270_064',
      '63_189',
      '1_801_434',
      '2_776_760',
      '2_980_845',
      '3_127_240',
      'buildPortableXrplNormalizedWork',
      'parseValidatedLedgerResult',
      'isLendingTransactionType',
      "epochId: 'supabase-r4c2c-historical-witness-v1'",
    ]) {
      expect(runner).toContain(required)
    }
  })

  it('records every seven-class count while distinguishing partial discovery from qualification', () => {
    for (const semanticClass of [
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'balance-history',
      'current-projection',
    ]) {
      expect(runner).toContain(`'${semanticClass}'`)
    }
    for (const required of [
      'missingNonLedgerClasses',
      'completeSixClassWitness',
      'lendingWitnessLedgerCount',
      'canonicalKeys',
      'relationshipIds',
      "mutation: 'none'",
      "purpose: 'r4c2c-read-only-historical-witness-discovery'",
    ]) {
      expect(runner).toContain(required)
    }
  })

  it('remains read-only and bounded even when historical ledgers are unavailable', () => {
    for (const required of [
      'REQUEST_TIMEOUT_MILLISECONDS = 15_000',
      'REQUEST_ATTEMPTS = 2',
      'CONCURRENCY = 6',
      'failed-historical-witness.json',
      'No requested historical Devnet ledger was readable',
    ]) {
      expect(runner).toContain(required)
    }
    for (const forbidden of [
      'submit_multisigned',
      "method: 'submit'",
      'wallet_propose',
      'seed',
      'SUPABASE_SERVICE_ROLE_KEY',
      'CLOUDFLARE_API_TOKEN',
      'MAINNET',
    ]) {
      expect(runner).not.toContain(forbidden)
    }
  })

  it('replaces the expired scheduled qualification without increasing workflow count', () => {
    for (const required of [
      'r4c2c-devnet-historical-witness.yml',
      'GitHub Actions workflow count must remain exactly eight',
      'no scheduled workflow is allowed during active R4 qualification',
    ]) {
      expect(allowlist).toContain(required)
    }
    expect(allowlist).not.toContain('complete-history-12-slot-qualification-995-v5.yml')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('push:')
    expect(workflow).not.toContain('schedule:')
  })

  it('publishes only sanitized read-only evidence to the dedicated issue', () => {
    for (const required of [
      'contents: read',
      'issues: write',
      'cancel-in-progress: false',
      'bun build scripts/qualify-devnet-historical-witness.ts',
      'node /tmp/qualify-devnet-historical-witness.mjs',
      'retention-days: 14',
      'gh issue comment 1118',
      'transaction submission: `none`',
      'database mutation: `none`',
    ]) {
      expect(workflow).toContain(required)
    }
    for (const forbidden of [
      'CLOUDFLARE_API_TOKEN',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_DB_PASSWORD',
      'wrangler deploy',
      'supabase db',
      'supabase functions deploy',
      'contents: write',
    ]) {
      expect(workflow).not.toContain(forbidden)
    }
  })
})
