import { describe, expect, it, vi } from 'vitest'

vi.mock('./entry', () => ({
  default: {
    scheduled: vi.fn(async () => undefined),
  },
}))

vi.mock('./repositories/fast-lane-shadow-run-metrics', () => ({
  saveFastLaneShadowRunHeartbeat: vi.fn(async () => undefined),
}))

describe('p0 heartbeat entry', () => {
  it('loads the wrapped scheduled handler', async () => {
    const module = await import('./p0-heartbeat-entry')
    expect(module.default.scheduled).toBeTypeOf('function')
  })
})
