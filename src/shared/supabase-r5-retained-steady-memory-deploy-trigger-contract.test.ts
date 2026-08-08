import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, unknown>
}

const fixture = json('scripts/fixtures/r5-retained-steady-memory-samples.json')
const deployEvidence = json('supabase/evidence/r5-retained-steady-memory-source.json')
const workflow = readFileSync(
  resolve(
    process.cwd(),
    'ops/retired/supabase-remote-probe-r4c-r5-workflow.snapshot.yml',
  ),
  'utf8',
)

describe('retained steady memory production trigger contract', () => {
  it('keeps deploy evidence synchronized with the exact memory fixture', () => {
    const memory = fixture.memory
    expect(memory).toBeTruthy()
    const canonicalDigest = createHash('sha256')
      .update(JSON.stringify(memory))
      .digest('hex')

    for (const key of [
      'sourceWorkflowRunId',
      'sourceCommit',
      'sourceArtifactId',
      'sourceArtifactDigest',
      'sourceSteadyEvidenceSha256',
      'memoryCanonicalSha256',
    ]) {
      expect(deployEvidence[key]).toBe(fixture[key])
    }
    expect(deployEvidence.memoryCanonicalSha256).toBe(canonicalDigest)
    expect(deployEvidence).toMatchObject({
      schemaVersion: 1,
      purpose: 'r5-retained-steady-memory-deploy-evidence',
      retainedSessionId: 'r4c2d-steady-msflb8fo-5ebc5adc',
      completedTicks: 6,
      memorySamples: 36,
      rssCounterUsable: false,
      g8Qualified: false,
      profileSelected: false,
      remoteProbeTrigger: 'supabase/**',
    })
  })

  it('retains the historical production-probe trigger contract outside executable Actions', () => {
    expect(workflow).toContain("- 'supabase/**'")
    expect(workflow).toContain('RETIRED / NON-EXECUTABLE CONTRACT SNAPSHOT')
    expect(deployEvidence.remoteProbeTrigger).toBe('supabase/**')
  })
})
