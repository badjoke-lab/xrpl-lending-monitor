import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const workflow = read('.github/workflows/r4f-g3-one-shot-probe.yml')
const script = read('scripts/capture-r4f-g3-concurrent-traffic-logs.mjs')
const captureJob = workflow.slice(workflow.indexOf('\n  capture_logs:'))

describe('R4F G3 read-only concurrent traffic log capture', () => {
  it('is generic but bound to one completed one-shot, successful resume, and fresh AFTER marker', () => {
    for (const required of [
      'github.event.issue.number == 1261',
      "github.event.comment.user.login == 'badjoke-lab'",
      "startsWith(github.event.comment.body, '/r4f-g3-capture-logs ')",
      "regex='^/r4f-g3-capture-logs run=([0-9]+) resume_run=([0-9]+) pause_run=([0-9]+) before_comment=([0-9]+) after_comment=([0-9]+) project=([a-f0-9]{64})$'",
      'verify-r4f-g3-after-sequence.mjs',
      '--resume-run /tmp/resume-run.json',
      '--after-comment-id "$after_comment"',
      'capture_start="$(jq -r ".beforeCapturedAt"',
      'capture_end="$(jq -r ".afterCapturedAt"',
      "if (!(afterAt < authorizationAt)) throw new Error('log capture authorization must follow verified AFTER marker')",
      "source_commit=\"$(jq -r '.head_sha' /tmp/target-run.json)\"",
    ]) {
      expect(captureJob).toContain(required)
    }
    expect(captureJob).not.toContain('31262884558')
    expect(captureJob).not.toContain('c1d0281b7ecdde77b69733b488104b4a7b8ba1ce')
    expect(captureJob).not.toContain("CAPTURE_START: '2026-")
    expect(captureJob).not.toContain("CAPTURE_END: '2026-")
  })

  it('has no Supabase mutation, database, R5, or Mainnet capability', () => {
    for (const forbidden of [
      'supabase functions deploy',
      'supabase functions delete',
      'supabase secrets set',
      'supabase secrets unset',
      'supabase db',
      'supabase link',
      'SUPABASE_DB_PASSWORD',
      'SUPABASE_SERVICE_ROLE_KEY',
      'xrpl-r5-recovery-batch',
      'MAINNET_ENABLED',
    ]) {
      expect(captureJob).not.toContain(forbidden)
    }
    expect(captureJob).toContain('read-only Supabase Management API log query')
    expect(captureJob).toContain('r4f-g3-concurrent-traffic-evidence')
  })

  it('uses the current ClickHouse logs endpoint and a one-hour hard maximum', () => {
    expect(script).toContain('/analytics/endpoints/logs`')
    expect(script).not.toContain('/analytics/endpoints/logs.all')
    expect(script).toContain('FROM logs')
    expect(script).toContain("source IN ('function_edge_logs', 'edge_logs', 'storage_logs', 'auth_logs', 'realtime_logs')")
    expect(script).toContain("parseDateTimeBestEffort('${start}')")
    expect(script).toContain('if (endMs - startMs > 60 * 60 * 1000)')
    expect(captureJob).toContain("if (end - start > 60 * 60 * 1000) throw new Error('provider interval exceeds one hour')")
  })

  it('sanitizes the project ref and retains only hashed request ids', () => {
    expect(script).toContain("replaceAll(projectRef, '[project]')")
    expect(script).toContain("idDigest: createHash('sha256')")
    expect(script).toContain('projectRefRetained: false')
    expect(script).toContain('credentialsRetained: false')
    expect(captureJob).toContain('! grep -Fq "$SUPABASE_PROJECT_ID" "$evidence"')
  })
})
