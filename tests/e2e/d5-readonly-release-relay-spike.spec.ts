import { test, expect } from '@playwright/test'

const RELAY = 'http://127.0.0.1:8788'
const REPO = 'badjoke-lab/xrpl-lending-monitor'
const BASE_TAG = 'd2-current-base-35558034659'
const CHANNEL_TAG = 'db-less-current-overlay-channel-v1'

test('isolated Worker relay: browser reads exact D2+D4 bytes and SHA', async ({ page }) => {
  await page.goto('/')
  const rows = await page.evaluate(async ({ relay, repo, baseTag, channelTag }) => {
    const api = (tag: string) =>
      `https://api.github.com/repos/${repo}/releases/tags/${tag}`
    const readRelease = async (tag: string) => {
      const response = await fetch(api(tag))
      if (!response.ok) throw Error(`GitHub channel API returned ${response.status}`)
      return response.json() as Promise<{
        body: string
        assets: Array<{ name: string; size: number; digest: string | null }>
      }>
    }
    const base = await readRelease(baseTag)
    const channel = await readRelease(channelTag)
    const pointer = JSON.parse(channel.body) as {
      active: { location: { releaseTag: string }; manifestKey: string; manifestSha256: string }
    }
    const baseAsset = base.assets.find((asset) => asset.name === 'base-manifest.json')
    if (!baseAsset) throw Error('Base manifest asset missing')

    const scenarios = [
      {
        label: 'D2 base manifest',
        tag: baseTag,
        key: 'base-manifest.json',
        expectedSize: baseAsset.size,
        expectedSha256: baseAsset.digest?.replace(/^sha256:/, '') ?? '',
      },
      {
        label: 'D4 active checkpoint manifest',
        tag: pointer.active.location.releaseTag,
        key: pointer.active.manifestKey,
        expectedSize: -1,
        expectedSha256: pointer.active.manifestSha256,
      },
    ]
    const results = []
    for (const scenario of scenarios) {
      const url = `${relay}/artifacts/${scenario.tag}/${scenario.key}`
      try {
        const response = await fetch(url)
        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        const digest = await crypto.subtle.digest('SHA-256', buffer)
        const sha = [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, '0')).join('')
        results.push({
          label: scenario.label,
          status: response.status,
          size: bytes.length,
          expectedSize: scenario.expectedSize,
          sha256: sha,
          expectedSha256: scenario.expectedSha256,
          cors: response.headers.get('access-control-allow-origin'),
          ok: response.ok && sha === scenario.expectedSha256 &&
            (scenario.expectedSize < 0 || bytes.length === scenario.expectedSize),
        })
      } catch (error) {
        results.push({
          label: scenario.label,
          status: 0, size: 0, expectedSize: scenario.expectedSize,
          sha256: null, expectedSha256: scenario.expectedSha256,
          cors: null, ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return results
  }, { relay: RELAY, repo: REPO, baseTag: BASE_TAG, channelTag: CHANNEL_TAG })
  console.log('D5_RELAY_SPIKE_REAL_BROWSER=' + JSON.stringify(rows))
  expect(rows.length).toBe(2)
  expect(rows.every((row) => row.ok)).toBe(true)
  expect(rows.every((row) => row.cors === '*')).toBe(true)
})

test('relay is not an open proxy and rejects non-GET methods', async ({ page }) => {
  await page.goto('/')
  const status = await page.evaluate(async (relay) => {
    const one = await fetch(`${relay}/artifacts/https:%2f%2fevil.test/secret`)
    const two = await fetch(`${relay}/artifacts/db-less-current-overlay-v1-100/current-overlay-v1-200-manifest.json`)
    const three = await fetch(`${relay}/artifacts/d2-current-base-35558034659/base-manifest.json`, { method: 'POST' })
    return [one.status, two.status, three.status]
  }, RELAY)
  expect(status).toEqual([400, 400, 405])
})
