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
  it('is generic but bound to one completed one-shot, successful resume, and provider capture interval', () => {
    for (const required of [
      'github.event.issue.number == 1261',
      "github.event.comment.user.login == 'badjoke-lab'",
      "startsWith(github.event.comment.body, '/r4f-g3-capture-logs ')",
      "regex='^/r4f-g3-capture-logs run=([0-9]+) resume_run=([0-9]+) start=([^ ]+) end=([^ ]+)$'",
      "if (target.conclusion !== 'success')",
      "if (resume.conclusion !== 'success')",
      "if (!(start <= runStart && runEnd <= end))",
      "if (!(runEnd < resumeStart && resumeEnd <= authorizationAt))",
      'source_commit="$(jq -r \' .head_sha\' /tmp/target-run.json)"'.replace("' .", "'."),
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
  })

  it('sanitizes the project ref and retains only hashed request ids', () => {
    expect(script).toContain("replaceAll(projectRef, '[project]')")
    expect(script).toContain("idDigest: createHash('sha256')")
    expect(script).toContain('projectRefRetained: false')
    expect(script).toContain('credentialsRetained: false')
    expect(captureJob).toContain('! grep -Fq "$SUPABASE_PROJECT_ID" "$evidence"')
  })
})
