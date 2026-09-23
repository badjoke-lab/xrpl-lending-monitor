import { describe, expect, it } from 'vitest'

import {
  currentOverlayCheckpointLedger,
  planDbLessCurrentOverlayRetention,
} from './current-overlay-retention'

function release(options: {
  id: number
  ledger?: number
  tag?: string
  draft?: boolean
  prerelease?: boolean
}) {
  return {
    id: options.id,
    tagName: options.tag ?? `db-less-current-overlay-v1-${options.ledger}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? true,
  }
}

describe('D4 Current overlay checkpoint retention', () => {
  it('keeps the active checkpoint plus two predecessors and marks only older D4 checkpoints deletable', () => {
    const plan = planDbLessCurrentOverlayRetention({
      activeTag: 'db-less-current-overlay-v1-400',
      releases: [
        release({ id: 4, ledger: 400 }),
        release({ id: 3, ledger: 300 }),
        release({ id: 2, ledger: 200 }),
        release({ id: 1, ledger: 100 }),
        release({ id: 90, tag: 'db-less-live-data-v1-20260924-00' }),
      ],
    })

    expect(plan.keep.map((item) => item.tagName)).toEqual([
      'db-less-current-overlay-v1-400',
      'db-less-current-overlay-v1-300',
      'db-less-current-overlay-v1-200',
    ])
    expect(plan.deleteCandidates.map((item) => item.tagName)).toEqual([
      'db-less-current-overlay-v1-100',
    ])
    expect(plan.ignored.map((item) => item.tagName)).toEqual([
      'db-less-live-data-v1-20260924-00',
    ])
  })

  it('protects draft and non-prerelease checkpoint Releases from automatic deletion', () => {
    const plan = planDbLessCurrentOverlayRetention({
      activeTag: 'db-less-current-overlay-v1-400',
      releases: [
        release({ id: 4, ledger: 400 }),
        release({ id: 3, ledger: 300 }),
        release({ id: 2, ledger: 200 }),
        release({ id: 1, ledger: 100, draft: true }),
        release({ id: 5, ledger: 50, prerelease: false }),
      ],
    })

    expect(plan.deleteCandidates).toEqual([])
    expect(new Set(plan.protected.map((item) => item.tagName))).toEqual(new Set([
      'db-less-current-overlay-v1-100',
      'db-less-current-overlay-v1-50',
    ]))
  })

  it('fails closed if a newer checkpoint exists but is not the active pointer', () => {
    expect(() => planDbLessCurrentOverlayRetention({
      activeTag: 'db-less-current-overlay-v1-300',
      releases: [
        release({ id: 4, ledger: 400 }),
        release({ id: 3, ledger: 300 }),
      ],
    })).toThrow('newer unactivated')
  })

  it('fails closed if the active checkpoint is not a published prerelease', () => {
    expect(() => planDbLessCurrentOverlayRetention({
      activeTag: 'db-less-current-overlay-v1-300',
      releases: [release({ id: 3, ledger: 300, draft: true })],
    })).toThrow('published prerelease')
  })

  it('parses only D4 Current overlay checkpoint tags', () => {
    expect(currentOverlayCheckpointLedger('db-less-current-overlay-v1-5537748')).toBe(5537748)
    expect(currentOverlayCheckpointLedger('db-less-live-data-v1-20260924-00')).toBeNull()
    expect(currentOverlayCheckpointLedger('db-less-current-overlay-channel-v1')).toBeNull()
  })
})
