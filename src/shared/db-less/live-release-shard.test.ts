import { describe, expect, it } from 'vitest'

import {
  nextDbLessLiveReleaseRotation,
  planDbLessLiveReleaseShard,
} from './live-release-shard'

describe('DB-less live Release shard planner', () => {
  it('maps timestamps into stable six-hour UTC buckets', () => {
    const plan = planDbLessLiveReleaseShard({
      timestamp: '2026-09-20T14:37:00.000Z',
      existingAssets: 120,
      plannedArtifacts: 3,
    })

    expect(plan).toMatchObject({
      bucketHours: 6,
      bucketStart: '2026-09-20T12:00:00.000Z',
      baseTag: 'db-less-live-data-v1-20260920-12',
      releaseTag: 'db-less-live-data-v1-20260920-12',
      projectedAssets: 123,
      maxAssets: 720,
      fits: true,
    })
  })

  it('rotates before exceeding the bounded shard ceiling', () => {
    const full = planDbLessLiveReleaseShard({
      timestamp: '2026-09-20T17:59:59.000Z',
      existingAssets: 719,
      plannedArtifacts: 3,
    })
    expect(full.fits).toBe(false)

    const rotated = nextDbLessLiveReleaseRotation(full)
    expect(rotated).toMatchObject({
      bucketStart: '2026-09-20T12:00:00.000Z',
      releaseTag: 'db-less-live-data-v1-20260920-12-r1',
      rotationIndex: 1,
      existingAssets: 0,
      plannedArtifacts: 3,
      projectedAssets: 3,
      fits: true,
    })
  })

  it('keeps exact ceiling occupancy valid', () => {
    const plan = planDbLessLiveReleaseShard({
      timestamp: '2026-09-20T00:00:00.000Z',
      existingAssets: 717,
      plannedArtifacts: 3,
    })
    expect(plan.projectedAssets).toBe(720)
    expect(plan.fits).toBe(true)
  })

  it('fails closed when one publication alone cannot fit the shard ceiling', () => {
    const full = planDbLessLiveReleaseShard({
      timestamp: '2026-09-20T00:00:00.000Z',
      existingAssets: 0,
      plannedArtifacts: 721,
    })
    expect(full.fits).toBe(false)

    const rotated = nextDbLessLiveReleaseRotation(full)
    expect(rotated.fits).toBe(false)
    expect(rotated.projectedAssets).toBe(721)
  })

  it('rejects bucket widths that do not divide a UTC day', () => {
    expect(() => planDbLessLiveReleaseShard({
      timestamp: '2026-09-20T00:00:00.000Z',
      existingAssets: 0,
      plannedArtifacts: 1,
      bucketHours: 5,
    })).toThrow('divide 24')
  })
})
