import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const workflow = read('.github/workflows/r4f-g3-isolated-window.yml')
const script = read('scripts/prepare-r4f-g3-isolated-window.mjs')

describe('R4F G3 isolated-window preparation safety', () => {
  it('runs only from the exact owner command on Issue 1261', () => {
    expect(workflow).toContain('issue_comment:')
    expect(workflow).toContain('github.event.issue.number == 1261')
    expect(workflow).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(workflow).toContain("github.event.comment.body == '/r4f-g3-isolation-prepare'")
    expect(workflow).not.toContain('\n  schedule:')
    expect(workflow).not.toContain('\n  push:')
  })

  it('is read-only and cannot pause or mutate the provider', () => {
    for (const forbidden of [
      'cron.unschedule',
      'cron.schedule',
      'supabase db',
      'supabase link',
      'supabase functions deploy',
      'supabase functions delete',
      'supabase secrets set',
      'supabase secrets unset',
      'xrpl-r5-recovery-batch',
      "MAINNET_ENABLED: 'true'",
    ]) {
      expect(workflow).not.toContain(forbidden)
      expect(script).not.toContain(forbidden)
    }
    expect(script).toContain('read_only: true')
    expect(script).toContain('/database/query`')
    expect(workflow).toContain('This preparation is read-only.')
  })

  it('pins the exact one-minute collector scheduler and stores only its command digest', () => {
    for (const required of [
      "'xrpl-lending-monitor-minute'",
      "schedule !== '* * * * *'",
      "'/functions/v1/xrpl-collector-tick'",
      "'source', 'pg_cron'",
      'function sha256(text)',
      "createHash('sha256').update(text).digest('hex')",
      'const commandDigest = sha256(command)',
      'commandRetained: false',
      'projectRefRetained: false',
      'credentialsRetained: false',
    ]) {
      expect(script).toContain(required)
    }
  })

  it('binds every dynamic revision-3 runtime clone source into one retained source-set digest', () => {
    for (const required of [
      'public.xrpl_prepare_r5_active_recovery(text,text,text,bigint,text,timestamp with time zone)',
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)',
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(text,timestamp with time zone)',
      'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)',
      'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)',
      'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)',
      'const runtimeSourceSetSha256 = sha256(canonicalSourceSet)',
      'r5_prepare_source_sha256=${runtimeSourceSetSha256}',
      'r5_runtime_source_set_sha256=${runtimeSourceSetSha256}',
      'allDynamicCloneSourcesBound: true',
    ]) {
      expect(script).toContain(required)
    }
  })

  it('retains a sanitized artifact and issue locator', () => {
    expect(workflow).toContain('r4f-g3-isolated-window-prepare-evidence')
    expect(workflow).toContain('retention-days: 14')
    expect(workflow).toContain('gh issue comment "$QUALIFICATION_ISSUE"')
    expect(workflow).toContain('Scheduler command digest:')
    expect(workflow).not.toContain('SUPABASE_DB_PASSWORD')
    expect(workflow).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})
