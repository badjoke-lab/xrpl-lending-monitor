import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const stagedPath = resolve(
  process.cwd(),
  'ops/production-sql/20260823013000_xrpl_terminal_scan_certificate_runtime.sql',
)
const proofPath = resolve(
  process.cwd(),
  'scripts/test-r5-terminal-scan-certificate-runtime-postgres.sh',
)
const staged = readFileSync(stagedPath, 'utf8')
const proof = readFileSync(proofPath, 'utf8')

describe('terminal scan certificate runtime staging', () => {
  it('stages rather than auto-deploys the production change', () => {
    expect(stagedPath).toContain('ops/production-sql/')
    expect(staged).toContain('Merge does not apply this file')
    expect(staged).toContain('separate Issue #1261 prepare -> exact OWNER authorization')
    expect(staged).toMatch(/^begin;/u)
    expect(staged.trimEnd()).toEndWith('commit;')
    expect(staged).not.toContain('SUPABASE_ACCESS_TOKEN')
  })

  it('pins exact current production source and transformed definition hashes', () => {
    for (const hash of [
      '3d7f4c7d7ed7cbd91b54f268dad5bdead09ef4eba278085e3146f45c07ebc899',
      '6f65875ec781135434326c53ed159c61154dc7f24728e02a9f578778dfea717d',
      '8d761a2bf69ea4228f18f482ab620e294354644f60eea6e8101a4efd55766a0a',
      'a7114afea201a32bd90c3f6ee08ae666e033e83bcc99384eb2a5b4a415f814b7',
      '0a37e55b8881847a61cf95f78746039fd6967571721aa50b5a0f1baff62fd1c6',
      '5e9cb3bfea6126c1d436ffb15fee5e8aaf6f2da3e0f83bf048d9cbdcf35040b0',
      'daf97c6858300a2ec4a00eb24f60b53936dc4aa56200accc16e098c64e8f37b7',
      '8c810628d2bf0be9aa25e8aab2a60a23912563e7524f177c35a4f261ca7c0eec',
    ]) {
      expect(staged).toContain(hash)
    }
    expect(staged).toContain('run 32586238190')
    expect(staged).toContain('e05253f1aebd502b89764b60dbeb8cabf2a3bb74')
  })

  it('uses the proven zero-default bounded fields without a work-row backfill', () => {
    expect(staged).toContain('add column source_scan_sequence integer not null default 0')
    expect(staged).toContain('add column next_scan_sequence integer not null default 0')
    expect(staged).not.toMatch(/create\s+table\s+.*certificate/iu)
    expect(staged).not.toMatch(
      /update\s+public\.xrpl_phase_work\s+set\s+source_scan_sequence\s*=\s*0/iu,
    )
  })

  it('preserves archive replay and certifies the four runtime transitions', () => {
    expect(staged).toContain('xrpl_complete_caught_up_scan')
    expect(staged).toContain('xrpl_complete_portable_scan_phase')
    expect(staged).toContain('xrpl_complete_portable_finalize_phase')
    expect(staged).toContain('xrpl_complete_r5_revision4_recovery_batch_without_qualification')
    expect(staged).toContain('v_archived_duplicate jsonb')
    expect(staged).toContain("raise exception 'scan sequence certificate conflict'")
    expect(staged).toContain('set next_scan_sequence = v_successor_sequence')
    expect(staged).toContain('source_scan_sequence = v_stream.next_scan_sequence')
    expect(staged).toContain("raise exception 'portable finalize scan sequence certificate conflict'")
    expect(staged).toContain('set next_scan_sequence = 0')
    expect(staged).toContain("or (v_pending_scan.payload->>'scanSequence')::integer <> 0")
    expect(staged).toContain('or v_stream.next_scan_sequence <> 0')
    expect(staged).toContain('expected_commit_chunks, source_scan_sequence,')
  })

  it('keeps owner/service-role guards and post-transform SHA verification', () => {
    expect(staged).toContain("pg_get_userbyid((select proowner from pg_proc where oid=v_signature)) <> 'postgres'")
    expect(staged).toContain("has_function_privilege('service_role',v_signature,'EXECUTE')")
    expect(staged).toContain('terminal_scan_certificate_transform_drift')
    expect(staged).toContain('terminal_scan_certificate_post_apply_drift')
  })

  it('keeps the local proof isolated and covers rollback/rejection semantics', () => {
    expect(proof).not.toContain('SUPABASE_ACCESS_TOKEN')
    expect(proof).not.toContain('/database/query')
    expect(proof).toContain("perform complete_caught_up('p','rollback1',true)")
    expect(proof).toContain('caught-up rollback failed')
    expect(proof).toContain("perform complete_r5('p','r5scan2','bad-r5-work')")
    expect(proof).toContain('r5 rejection mutation leaked')
  })

  it.runIf(Boolean(process.env.CI))(
    'runs the disposable PostgreSQL atomic proof',
    () => {
      execFileSync('bash', [proofPath], {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 120_000,
      })
    },
    130_000,
  )
})
