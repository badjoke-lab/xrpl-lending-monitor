import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const script = readFileSync(
  resolve(process.cwd(), 'scripts/build-r4f-revision4-offline-shadow.mjs'),
  'utf8',
)
const lower = script.toLowerCase()

describe('revision-4 G2C offline shadow script contract', () => {
  it('reads one retained fixture and writes artifact files only', () => {
    for (const required of [
      'runSupabaseRevision4OfflineShadow',
      'revision4-offline-shadow-fixture.json',
      'evidence.json',
      'persistence-rpc-request.json',
      'evidence.md',
      'noNetworkRequestIssued',
      'noDatabaseRequestIssued',
      'recoveryMutationCommitted',
    ]) {
      expect(script).toContain(required)
    }
  })

  it('contains no network, database, deployment, or recovery executor call', () => {
    for (const forbidden of [
      'fetch(',
      'supabase_access_token',
      'supabase_project_id',
      'supabase_service_role_key',
      'database/query',
      'supabase db',
      'supabase functions deploy',
      'xrpl_record_r4f_revision4_directional_accounting',
      'run-supabase-r5-recovery',
      'r5-recovery-selected-revision3-entry',
      'gh issue comment',
    ]) {
      expect(lower).not.toContain(forbidden)
    }
  })
})
