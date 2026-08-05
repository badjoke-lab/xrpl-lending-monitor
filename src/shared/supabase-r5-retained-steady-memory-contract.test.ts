import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const fixtureSource = read('scripts/fixtures/r5-retained-steady-memory-samples.json')
const fixture = JSON.parse(fixtureSource) as {
  schemaVersion: number
  purpose: string
  sourceWorkflowRunId: number
  sourceCommit: string
  sourceArtifactId: number
  sourceArtifactDigest: string
  sourceSteadyEvidenceSha256: string
  memoryCanonicalSha256: string
  memory: {
    purpose: string
    sessionId: string
    completedTicks: number
    measuredCompletedTicks: number
    ticks: Array<{
      status: string
      tickSequence: number
      memorySamples: Array<{
        phase: string
        rssBytes: number
        heapTotalBytes: number
        heapUsedBytes: number
        externalBytes: number
      }>
    }>
  }
}
const reconciler = read('scripts/reconcile-supabase-steady-memory-capability.mjs')

describe('retained R5 steady memory samples', () => {
  it('pins the exact successful workflow artifact and memory digest', () => {
    expect(fixture).toMatchObject({
      schemaVersion: 1,
      purpose: 'r5-retained-steady-memory-samples',
      sourceWorkflowRunId: 30975277983,
      sourceCommit: 'd7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c',
      sourceArtifactId: 8918144753,
      sourceArtifactDigest: 'sha256:c0f519dc4a1fe5dfff3f0ae79641cc84fd54e99fb2f0b2d073f20639e1dda2ac',
      sourceSteadyEvidenceSha256: 'fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c',
      memoryCanonicalSha256: 'e8c359e23189c37c4f74aa3e66a83913a26977dca6b91896804cd1c48c992f40',
    })
    expect(createHash('sha256').update(JSON.stringify(fixture.memory)).digest('hex'))
      .toBe(fixture.memoryCanonicalSha256)
  })

  it('retains six completed ticks and all thirty-six lifecycle samples', () => {
    expect(fixture.memory).toMatchObject({
      purpose: 'r4c2d-steady-memory-guard',
      sessionId: 'r4c2d-steady-msflb8fo-5ebc5adc',
      completedTicks: 6,
      measuredCompletedTicks: 6,
    })
    expect(fixture.memory.ticks.map((tick) => tick.tickSequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(fixture.memory.ticks.every((tick) => tick.status === 'completed')).toBe(true)
    expect(fixture.memory.ticks.every((tick) => tick.memorySamples.length === 6)).toBe(true)

    const samples = fixture.memory.ticks.flatMap((tick) => tick.memorySamples)
    expect(samples).toHaveLength(36)
    expect(samples.every((sample) => sample.rssBytes === 0)).toBe(true)
    expect(samples.some((sample) => sample.heapTotalBytes > 0)).toBe(true)
    expect(samples.some((sample) => sample.heapUsedBytes > 0)).toBe(true)
    expect(samples.some((sample) => sample.externalBytes > 0)).toBe(true)
    expect(new Set(samples.map((sample) => sample.phase))).toEqual(new Set([
      'request_start',
      'after_claim',
      'after_head',
      'after_fetch',
      'after_normalize',
      'before_commit',
    ]))
  })

  it('restores samples only for the exact retained source and keeps memory fail closed', () => {
    for (const required of [
      "evidence.retainedDuringR5Recovery !== true",
      'retainedSource.sourceWorkflowRunId !== sourceWorkflowRunId',
      'retainedSource.sourceCommit !== sourceCommit',
      'retainedSource.sourceArtifactId !== sourceArtifactId',
      'retainedSource.sourceArtifactDigest !== sourceArtifactDigest',
      'retainedSource.sourceSteadyEvidenceSha256 !== sourceSteadyEvidenceSha256',
      'canonicalDigest(memory) !== memoryCanonicalSha256',
      'const usableTotalMemoryCounter = !allRssCountersZero',
      'partialHeapCountersNotSubstitutedForRss: true',
      'zeroRssNotInterpretedAsZeroUsage: true',
      'memoryHeadroomQualified: usableTotalMemoryCounter',
      'g8Qualified: false',
      'profileSelected: false',
      'noFreshQualificationExecuted: true',
    ]) {
      expect(reconciler).toContain(required)
    }
    expect(reconciler).not.toContain('usableTotalMemoryCounter = partialHeapCountersAvailable')
    expect(reconciler).not.toContain('g8Qualified: true')
    expect(reconciler).not.toContain('profileSelected: true')
  })
})
