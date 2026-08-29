import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SCRIPT = 'scripts/deploy-current-repair-only.py'
const RUNTIME_SHA = '4f3f185da6e5093d0a5ce13b43b22f3070e630b3'

describe('Current repair deploy-only operation', () => {
  it('is valid Python and pins the exact repaired runtime', () => {
    const compile = spawnSync('python', ['-m', 'py_compile', SCRIPT], { encoding: 'utf8' })
    expect({ status: compile.status, stderr: compile.stderr }).toEqual({ status: 0, stderr: '' })

    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).toContain(`EXPECTED_RUNTIME_SHA = "${RUNTIME_SHA}"`)
    expect(source).toContain('const DEFAULT_MAX_ATTEMPTS = 1')
    expect(source).toContain('FAST_LANE_HTTP_FALLBACK_REQUEST_LIMIT = 4')
    expect(source).toContain('FAST_LANE_MAX_PERSISTENCE_D1_QUERIES = 24')
    expect(source).toContain('MUTATIONS_PER_D1_QUERY = 256')
    expect(source).toContain('HISTORY_WINDOWS_PER_D1_QUERY = 8')
  })

  it('contains no Queue restart, Queue purge, Queue send, Cron write, or D1 write operation', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).toContain('worker_version_deploy_only')
    expect(source).toContain('queueMessageSent": False')
    expect(source).toContain('queueResumed": False')
    expect(source).toContain('queuePurged": False')
    expect(source).toContain('cronChanged": False')
    expect(source).toContain('d1Mutation": False')

    for (const forbidden of [
      'delivery_paused": False',
      '/purge',
      '.send(',
      'wrangler d1',
      'd1 execute',
    ]) {
      expect(source).not.toContain(forbidden)
    }

    expect(source.match(/api\("(?:POST|PATCH|PUT|DELETE)"/g)).toBeNull()
  })

  it('requires the Queue to already be paused and preserves rollback-only mutation after deploy', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).toContain('Queue must already be paused')
    expect(source).toContain('CURRENT_REPAIR_DEPLOY_AUTHORIZATION')
    expect(source).toContain(`deploy-current-repair-only:${RUNTIME_SHA}`)
    expect(source).toContain('wrangler", "versions", "upload"')
    expect(source).toContain('wrangler", "versions", "deploy"')
    expect(source).toContain('assert_runtime_still_stopped("post-deploy")')
    expect(source).toContain('assert_runtime_still_stopped("rollback")')
  })
})
