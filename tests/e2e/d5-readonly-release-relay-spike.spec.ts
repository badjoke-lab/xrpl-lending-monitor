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

test('real browser reads D2 lookup, D4 shard and D3 live assets with exact SHA', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async ({ relay, repo, baseTag, d4ChannelTag }) => {
    const api = async (tag: string) => {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`)
      if (!response.ok) throw Error(`GitHub metadata fetch failed: ${response.status}`)
      return response.json() as Promise<{
        body: string
        assets: Array<{ name: string; size: number; digest: string | null }>
      }>
    }
    const baseRelease = await api(baseTag)
    const d4Release = await api(d4ChannelTag)
    const d3Release = await api('db-less-live-channel-candidate-v1')
    const d4 = JSON.parse(d4Release.body) as {
      active: { location: { releaseTag: string }; manifestKey: string }
    }
    const d3 = JSON.parse(d3Release.body) as {
      currentProjectionTail: {
        generations: Array<{
          generationId: string
          location: { releaseTag: string }
          manifestKey: string
          manifestSha256: string
        }>
      }
    }
    const latest = d3.currentProjectionTail.generations.at(-1)
    if (!latest) throw Error('No D3 tail generation')
    const d3Assets = await api(latest.location.releaseTag)
    const d3Chunk = d3Assets.assets.find((value) =>
      value.name.startsWith(latest.generationId) && value.name.includes('-chunk-'))
    const baseLookup = baseRelease.assets.find((value) => /^lookup-[0-9A-F]+\.json\.gz$/.test(value.name))
    if (!baseLookup || !d3Chunk) throw Error('Required actual D2/D3 asset not found')
    const d4ManifestResponse = await fetch(`${relay}/artifacts/${d4.active.location.releaseTag}/${d4.active.manifestKey}`)
    if (!d4ManifestResponse.ok) throw Error('D4 relay manifest unavailable')
    const d4Manifest = await d4ManifestResponse.json() as {
      shards: Array<{ key: string; bytes: number; artifactSha256: string }>
    }
    const shard = d4Manifest.shards[0]
    if (!shard) throw Error('D4 manifest has no shards')
    const assets = [
      {
        label: 'D2 indexed lookup bucket',
        tag: baseTag, name: baseLookup.name, bytes: baseLookup.size,
        sha: baseLookup.digest?.replace(/^sha256:/, '') ?? '',
      },
      {
        label: 'D4 bounded overlay shard',
        tag: d4.active.location.releaseTag, name: shard.key,
        bytes: shard.bytes, sha: shard.artifactSha256,
      },
      {
        label: 'D3 live tail manifest',
        tag: latest.location.releaseTag, name: latest.manifestKey,
        bytes: -1, sha: latest.manifestSha256,
      },
      {
        label: 'D3 live chunk',
        tag: latest.location.releaseTag, name: d3Chunk.name,
        bytes: d3Chunk.size, sha: d3Chunk.digest?.replace(/^sha256:/, '') ?? '',
      },
    ]
    const findings = []
    for (const asset of assets) {
      const response = await fetch(`${relay}/artifacts/${asset.tag}/${asset.name}`)
      const payload = await response.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', payload)
      const sha = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0')).join('')
      findings.push({
        label: asset.label,
        status: response.status,
        actualBytes: payload.byteLength,
        expectedBytes: asset.bytes,
        digestOk: sha === asset.sha,
        bytesOk: asset.bytes < 0 || payload.byteLength === asset.bytes,
        cors: response.headers.get('access-control-allow-origin'),
      })
    }
    return findings
  }, {
    relay: RELAY, repo: REPO, baseTag: BASE_TAG, d4ChannelTag: CHANNEL_TAG,
  })
  console.log('D5_RELAY_SPIKE_REAL_ASSETS=' + JSON.stringify(result))
  expect(result.length).toBe(4)
  expect(result.every((item) => item.status === 200 && item.bytesOk && item.digestOk && item.cors === '*')).toBe(true)
})
