import { afterEach, describe, expect, it, vi } from 'vitest'
import relay from './d5-readonly-release-relay-spike'

const TAG = 'db-less-live-data-v1-20261011-16'
const CURRENT_ONLY = 'live-v1-101-102-aaaaaaaaaaaaaaaa-cccccccccccc-current-only-v1.json.gz'

afterEach(() => vi.unstubAllGlobals())

describe('isolated D5 relay Current-only allowlist', () => {
  it('streams only the exact immutable Current-only D3 filename', async () => {
    const upstream = new Response('proof', {
      status: 200,
      headers: { 'content-length': '5' },
    })
    Object.defineProperty(upstream, 'url', {
      value: 'https://release-assets.githubusercontent.com/proof',
    })
    const requestUpstream = vi.fn().mockResolvedValue(upstream)
    vi.stubGlobal('fetch', requestUpstream)

    const response = await relay.fetch(new Request(
      `https://example.test/artifacts/${TAG}/${CURRENT_ONLY}`,
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe('proof')
    expect(requestUpstream).toHaveBeenCalledWith(
      `https://github.com/badjoke-lab/xrpl-lending-monitor/releases/download/${TAG}/${CURRENT_ONLY}`,
      expect.objectContaining({ method: 'GET', redirect: 'follow' }),
    )
  })

  it('retries temporary upstream failure only within the three-request ceiling', async () => {
    const unavailable = new Response('temporary', { status: 503 })
    const available = new Response('proof', { status: 200, headers: { 'content-length': '5' } })
    Object.defineProperty(unavailable, 'url', { value: 'https://github.com/upstream' })
    Object.defineProperty(available, 'url', { value: 'https://release-assets.githubusercontent.com/proof' })
    const fetchUpstream = vi.fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(available)
    vi.stubGlobal('fetch', fetchUpstream)
    const response = await relay.fetch(new Request(
      `https://example.test/artifacts/${TAG}/${CURRENT_ONLY}`,
    ))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('proof')
    expect(fetchUpstream).toHaveBeenCalledTimes(2)
  })

  it('fails closed for a missing asset with no retry, exposing upstream status', async () => {
    const missing = new Response('missing', { status: 404 })
    Object.defineProperty(missing, 'url', { value: 'https://github.com/upstream' })
    const fetchUpstream = vi.fn().mockResolvedValue(missing)
    vi.stubGlobal('fetch', fetchUpstream)
    const response = await relay.fetch(new Request(
      `https://example.test/artifacts/${TAG}/${CURRENT_ONLY}`,
    ))
    expect(response.status).toBe(502)
    expect(await response.text()).toContain('HTTP 404')
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-class and unversioned Current-only paths without upstream fetch', async () => {
    const requestUpstream = vi.fn()
    vi.stubGlobal('fetch', requestUpstream)
    const invalidPaths = [
      `/artifacts/db-less-current-overlay-v1-100/${CURRENT_ONLY}`,
      `/artifacts/${TAG}/live-v1-101-102-aaaaaaaaaaaaaaaa-cccccccccccc-current-only-v2.json`,
      `/artifacts/${TAG}/live-v1-101-102-aaaaaaaaaaaaaaaa-cccccccccccc-current-only-v1.json`,
    ]
    for (const path of invalidPaths) {
      const response = await relay.fetch(new Request(`https://example.test${path}`))
      expect(response.status).toBe(400)
    }
    expect(requestUpstream).not.toHaveBeenCalled()
  })
})
