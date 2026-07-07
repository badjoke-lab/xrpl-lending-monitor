import { describe, expect, it } from 'vitest'
import { crossSurfaceState } from './cross-surface-state'

describe('cross-surface state', () => {
  it('requires complete linked evidence', () => {
    expect(crossSurfaceState({ loan: true, lifecycle: true, source: true, history: true, gap: false })).toBe('observed')
    expect(crossSurfaceState({ loan: false, lifecycle: false, source: false, history: false, gap: false })).toBe('missing')
  })

  it('rejects presence disagreement and linkage gaps', () => {
    expect(crossSurfaceState({ loan: true, lifecycle: false, source: true, history: true, gap: false })).toBe('inconsistent')
    expect(crossSurfaceState({ loan: true, lifecycle: true, source: true, history: true, gap: true })).toBe('inconsistent')
  })
})
