import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260805070000_xrpl_r5_reclaim_catchup_qualification_storage.sql',
)
const retainedVerifier = read(
  'scripts/verify-supabase-retained-r5-qualification-evidence.mjs',
)
const catchUpVerifier = read('scripts/verify-supabase-catchup-throughput.mjs')
const steadyVerifier = read('scripts/verify-supabase-steady-throughput-with-retry.mjs')

describe('R5 qualification reclaim contract', () => {
  it('binds the reclaim to exact successful source evidence and active R5 identity', () => {
    for (const required of [
      "'r5-catchup-reclaim-20260805-v1'",
      "'r5-recovery-selected-revision3-entry'",
      "'r4c2d-msflb2xi-9529f8e9'",
      '30975277983',
      "'d7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c'",
      '8918144753',
      "'sha256:c0f519dc4a1fe5dfff3f0ae79641cc84fd54e99fb2f0b2d073f20639e1dda2ac'",
      "'165f01e582bc4e52e1676d143a240429d203ae803bd0eabfb4c5069ac7d6870b'",
      "'fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c'",
      "'3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'",
      "'13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'",
    ]) {
      expect(migration).toContain(required)
      expect(retainedVerifier).toContain(required.replaceAll("'", ''))
    }
  })

  it('archives five complete trials before reclaiming only catch-up qualification tables', () => {
    for (const required of [
      "v_retained_run_id || '-t1'",
      "v_retained_run_id || '-t5'",
      "item->>'target_profile_id' <> 'supabase-devnet-catchup-qualification'",
      "(item->>'source_count')::integer <> 64",
      "(item->>'message_count')::integer <> 193",
      "(item->>'completed_message_count')::integer <> 192",
      "(item->>'pending_message_count')::integer <> 1",
      "(item->>'successor_count')::integer <> 192",
      "(item->'result'->>'committedWorks')::integer <> 64",
      'insert into xrpl_qualification_archive_v1.catchup_reclaims',
      'public.xrpl_transfer_json_digest(v_evidence)',
      'r5_catchup_reclaim_active_watermark_changed',
    ]) {
      expect(migration).toContain(required)
    }

    const truncateBlock = migration.match(/truncate table([\s\S]*?);/i)?.[1] ?? ''
    for (const table of [
      'successors',
      'messages',
      'payload_chunks',
      'reference_rows',
      'commit_chunks',
      'work',
      'watermarks',
      'streams',
      'source_works',
      'trials',
    ]) {
      expect(truncateBlock).toContain(`xrpl_catchup_v1.${table}`)
    }
    for (const forbidden of ['public.', 'xrpl_r5_v1.', 'xrpl_steady_v1.', 'xrpl_resource_guard']) {
      expect(truncateBlock).not.toContain(forbidden)
    }
  })

  it('verifies the reclaimed database and retained steady session read-only', () => {
    for (const required of [
      'read_only: true',
      "archive.archive_id = $1::text",
      "session.session_id = $3::text",
      "running.status = 'running'",
      'databaseBytes >= databaseHaltBytes',
      "integer(state.catchupLiveRows, 'catch-up live rows') !== 0",
      "integer(state.catchupTotalBytes, 'catch-up total bytes') >= 17_000_000",
      "integer(steady.completed_ticks, 'steady completed ticks') !== 6",
      "integer(steady.committed_ledgers, 'steady committed ledgers') !== 144",
      "integer(steady.running_sessions, 'steady running sessions') !== 0",
      'noFreshQualificationExecuted: true',
    ]) {
      expect(retainedVerifier).toContain(required)
    }

    const querySql = retainedVerifier.match(/const sql = `([\s\S]*?)`\n/)?.[1] ?? ''
    expect(querySql.length).toBeGreaterThan(100)
    for (const forbidden of [
      /\binsert\s+into\b/i,
      /\bupdate\s+[a-z_]/i,
      /\bdelete\s+from\b/i,
      /\btruncate\s+table\b/i,
      /\bdrop\s+(table|schema|function)\b/i,
      /\balter\s+table\b/i,
    ]) {
      expect(querySql).not.toMatch(forbidden)
    }
  })

  it('reuses retained evidence before either expensive qualification can execute', () => {
    for (const source of [catchUpVerifier, steadyVerifier]) {
      expect(source).toContain(
        "import { verifyRetainedR5Qualifications } from './verify-supabase-retained-r5-qualification-evidence.mjs'",
      )
      expect(source).toContain('const retained = await verifyRetainedR5Qualifications()')
      expect(source).toContain('if (retained !== null)')
    }

    expect(catchUpVerifier.indexOf('const retained = await verifyRetainedR5Qualifications()'))
      .toBeLessThan(catchUpVerifier.indexOf('const response = await requestRaw()'))
    expect(steadyVerifier.indexOf('const retained = await verifyRetainedR5Qualifications()'))
      .toBeLessThan(steadyVerifier.indexOf('const first = await runVerifier(1)'))
  })

  it('keeps the fixed halt and release boundaries fail closed', () => {
    for (const required of [
      'const databaseHaltBytes = 400_000_000',
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
      'R5RecoveryIdentityUnchanged: true',
    ]) {
      expect(retainedVerifier).toContain(required)
    }

    for (const forbidden of [
      'databaseHaltBytes = 500_000_000',
      'memoryHaltBytes =',
      "mainnetEnabled: true",
      'stabilizationAuthorized: true',
      'soakAuthorized: true',
    ]) {
      expect(`${migration}\n${retainedVerifier}`).not.toContain(forbidden)
    }
  })
})
