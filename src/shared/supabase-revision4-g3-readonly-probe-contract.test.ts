import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const edge = read('supabase/functions/xrpl-r4f-g3-directional-probe/index.ts')
const config = read('supabase/config.toml')
const remoteWorkflow = read('.github/workflows/supabase-remote-probe.yml')

describe('Supabase revision-4 G3 read-only directional probe contract', () => {
  it('is Devnet-only, token-guarded, and reads one explicit validated ledger', () => {
    for (const required of [
      "'r4f-g3-directional-readonly-probe'",
      "'x-xrpl-reader-purpose'",
      "'x-xrpl-reader-token'",
      "env('R4F_G3_PROBE_VERIFY_TOKEN')",
      "env('R4F_G3_PROBE_SOURCE_COMMIT')",
      "'https://s.devnet.rippletest.net:51234/'",
      "method: 'ledger'",
      'ledger_index: ledgerIndex',
      'transactions: true',
      'expand: true',
      'result.validated !== true',
      'returnedLedgerIndex(result) !== ledgerIndex',
    ]) {
      expect(edge).toContain(required)
    }
  })

  it('uses the revision-4 directional meter and returns compact evidence instead of the raw XRPL body', () => {
    for (const required of [
      'buildSupabaseRevision4G3ReadonlyProbeResponse',
      'sha256HexBytes',
      'xrplResponseDigest',
      'built.responseBody',
    ]) {
      expect(edge).toContain(required)
    }
    expect(edge).not.toContain('xrplResponseBody,\n    status: 200')
  })

  it('contains no Supabase database or R5 writer path and no transaction submission', () => {
    for (const forbidden of [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      '/rest/v1/',
      '/rpc/',
      'xrpl_r5_v1',
      'r5-recovery',
      "method: 'submit'",
      'signing',
      'seed',
    ]) {
      expect(edge).not.toContain(forbidden)
    }
    expect(edge).toContain('databaseRequestIssued: false')
    expect(edge).toContain('recoveryMutationCommitted: false')
    expect(edge).toContain('mainnetDisabled: true')
  })

  it('is preparation-only and cannot be deployed by the current config or guarded remote workflow', () => {
    expect(config).not.toContain('[functions.xrpl-r4f-g3-directional-probe]')
    expect(remoteWorkflow).not.toContain('xrpl-r4f-g3-directional-probe')
    expect(remoteWorkflow).not.toContain('R4F_G3_PROBE_VERIFY_TOKEN')
    expect(remoteWorkflow).not.toContain('R4F_G3_PROBE_SOURCE_COMMIT')
  })
})
