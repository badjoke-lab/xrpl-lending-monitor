import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const markerPath = resolve(
  process.cwd(),
  'ops/r4f/run-once-20260806-g4-memory-replay.marker',
)
const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')
const runnerPath = resolve(
  process.cwd(),
  'scripts/run-r4f-revision4-memory-replay.mjs',
)
const marker = readFileSync(markerPath, 'utf8')
const workflow = readFileSync(workflowPath, 'utf8')
const runner = readFileSync(runnerPath, 'utf8')

describe('R4F G4 bounded memory replay workflow contract', () => {
  it('pins the one-shot marker and authorization', () => {
    expect(createHash('sha256').update(marker).digest('hex')).toBe(
      '695d93c22dc2c2db76fdd352e4b9319de2573235f05e692833ab16fb4758a70e',
    )
    expect(marker).toContain('issue=1261')
    expect(marker).toContain('authorization_comment=5401115525')
    expect(marker).toContain('source_start_ledger=4138468')
    expect(marker).toContain('source_end_ledger=4138491')
    expect(marker).toContain('claim_cap_ledgers=12')
    expect(marker).toContain('memory_halt_bytes=234881024')
  })

  it('runs only for the exact main-push marker introduced by badjoke-lab', () => {
    for (const required of [
      "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "marker='ops/r4f/run-once-20260806-g4-memory-replay.marker'",
      'git diff-tree --no-commit-id --name-only -r "$GITHUB_SHA"',
      "test \"$marker_sha\" = 695d93c22dc2c2db76fdd352e4b9319de2573235f05e692833ab16fb4758a70e",
      "test \"$author_login\" = badjoke-lab",
      'gh issue comment 1261',
      'r4f-g4-memory-replay-evidence',
      'retention-days: 14',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('separates public capture from network-disabled replay', () => {
    expect(workflow).toContain('Capture exact public Devnet source range')
    expect(workflow).toContain('Replay exact twelve-ledger halt shape offline')
    expect(workflow).toContain('Replay heavier retained shape offline')
    expect(workflow).toContain('--shape exact')
    expect(workflow).toContain('--shape heavier')

    const exactReplay = workflow.slice(
      workflow.indexOf('Replay exact twelve-ledger halt shape offline'),
      workflow.indexOf('Replay heavier retained shape offline'),
    )
    const heavierReplay = workflow.slice(
      workflow.indexOf('Replay heavier retained shape offline'),
      workflow.indexOf('Assemble revision-4 memory evidence'),
    )
    expect(exactReplay).not.toContain('--allow-net')
    expect(heavierReplay).not.toContain('--allow-net')
  })

  it('keeps credentials, production mutation, and release gates out of the replay', () => {
    for (const forbidden of [
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_DB_PASSWORD',
      'SUPABASE_SERVICE_ROLE_KEY',
      'supabase db push',
      'supabase functions deploy',
      'wrangler deploy',
      "MAINNET_ENABLED: 'true'",
    ]) {
      expect(workflow.slice(workflow.indexOf('r4f-g4-memory-replay:'))).not.toContain(
        forbidden,
      )
      expect(runner).not.toContain(forbidden)
    }
  })

  it('locks the revision-4 guard, cap, source range, and authorization in the runner', () => {
    for (const required of [
      'const MEMORY_HALT_BYTES = 224 * 1024 * 1024',
      'const CLAIM_CAP_LEDGERS = 12',
      'const SOURCE_START_LEDGER = 4_138_468',
      'const SOURCE_END_LEDGER = 4_138_491',
      'const AUTHORIZATION_ISSUE = 1261',
      'const AUTHORIZATION_COMMENT = 5401115525',
      "evidenceClass: 'bounded_offline_replay'",
      "memoryMetric: 'process_rss_bytes'",
      'networkAccessDuringReplay: false',
      'productionMutationPerformed: false',
      'recoveryMutationCommitted: false',
    ]) {
      expect(runner).toContain(required)
    }
  })
})
