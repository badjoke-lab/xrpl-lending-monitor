import { expect, test } from '@playwright/test'

const REPOSITORY = 'badjoke-lab/xrpl-lending-monitor'
const D2_BASE_TAG = 'd2-current-base-35558034659'
const D3_CHANNEL_TAG = 'db-less-live-channel-candidate-v1'
const D4_CHANNEL_TAG = 'db-less-current-overlay-channel-v1'

test('real Chromium can read public Devnet channel and immutable Release assets without credentials', async ({ page }) => {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.log('D5_BROWSER_CONSOLE=' + message.text())
    }
  })
  page.on('requestfailed', (request) => {
    console.log('D5_BROWSER_REQUEST_FAILED=' + request.url() + ' ' + (request.failure()?.errorText ?? 'unknown'))
  })
  await page.goto('/')
  const result = await page.evaluate(async (input) => {
    const attempts: Array<{
      name: string
      url: string
      ok: boolean
      status: number | null
      bytes: number | null
      error: string | null
    }> = []
    async function read(name: string, url: string): Promise<string | null> {
      try {
        const response = await fetch(url, { redirect: 'follow' })
        if (!response.ok) {
          attempts.push({ name, url, ok: false, status: response.status, bytes: null, error: 'HTTP response not OK' })
          return null
        }
        const bytes = await response.arrayBuffer()
        const text = new TextDecoder().decode(bytes)
        attempts.push({ name, url, ok: true, status: response.status, bytes: bytes.byteLength, error: null })
        return text
      } catch (error) {
        attempts.push({
          name, url, ok: false, status: null, bytes: null,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    }

    const api = (tag: string) =>
      `https://api.github.com/repos/${input.repository}/releases/tags/${tag}`
    const d3Body = await read('D3 channel GitHub API', api(input.d3Tag))
    const d4Body = await read('D4 channel GitHub API', api(input.d4Tag))
    if (d3Body) {
      try {
        const data = JSON.parse(d3Body) as { body?: string }
        if (!data.body) throw Error('Missing D3 channel body')
        JSON.parse(data.body)
      } catch (error) {
        attempts.push({
          name: 'D3 channel JSON', url: api(input.d3Tag),
          ok: false, status: null, bytes: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (d4Body) {
      try {
        const data = JSON.parse(d4Body) as { body?: string }
        if (!data.body) throw Error('Missing D4 channel body')
        const channel = JSON.parse(data.body) as {
          active: { location: { releaseTag: string }; manifestKey: string }
        }
        await read(
          'D4 immutable checkpoint manifest',
          `https://github.com/${input.repository}/releases/download/${encodeURIComponent(channel.active.location.releaseTag)}/${encodeURIComponent(channel.active.manifestKey)}`,
        )
      } catch (error) {
        attempts.push({
          name: 'D4 channel JSON', url: api(input.d4Tag),
          ok: false, status: null, bytes: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await read(
      'D2 immutable base manifest',
      `https://github.com/${input.repository}/releases/download/${input.d2Tag}/base-manifest.json`,
    )

    // GitHub API is CORS-readable: check whether its public asset endpoint
    // actually serves the binary asset rather than asset metadata JSON.
    const candidates: Array<{ tag: string; name: string }> = [
      { tag: input.d2Tag, name: 'base-manifest.json' },
    ]
    if (d4Body) {
      const channel = JSON.parse((JSON.parse(d4Body) as { body: string }).body) as {
        active: { location: { releaseTag: string }; manifestKey: string }
      }
      candidates.push({
        tag: channel.active.location.releaseTag,
        name: channel.active.manifestKey,
      })
    }
    for (const candidate of candidates) {
      const metadata = await read('Release metadata for ' + candidate.tag, api(candidate.tag))
      if (!metadata) continue
      const release = JSON.parse(metadata) as {
        assets: Array<{ name: string; id: number; size: number }>
      }
      const asset = release.assets.find((value) => value.name === candidate.name)
      if (!asset) {
        attempts.push({
          name: 'Find Release asset ' + candidate.name,
          url: api(candidate.tag), ok: false, status: null,
          bytes: null, error: 'Asset metadata not found',
        })
        continue
      }
      for (const accept of ['application/octet-stream', 'application/vnd.github.raw+json']) {
        const assetUrl = `https://api.github.com/repos/${input.repository}/releases/assets/${asset.id}`
        try {
          const response = await fetch(assetUrl, {
            headers: { Accept: accept },
            redirect: 'follow',
          })
          const bytes = await response.arrayBuffer()
          const valid = response.ok && bytes.byteLength === asset.size
          attempts.push({
            name: candidate.name + ' via GitHub API asset ' + accept,
            url: assetUrl, ok: valid,
            status: response.status, bytes: bytes.byteLength,
            error: valid ? null : `Expected ${asset.size} binary bytes, received ${bytes.byteLength}`,
          })
        } catch (error) {
          attempts.push({
            name: candidate.name + ' via GitHub API asset ' + accept,
            url: assetUrl, ok: false, status: null, bytes: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    return attempts
  }, {
    repository: REPOSITORY,
    d2Tag: D2_BASE_TAG,
    d3Tag: D3_CHANNEL_TAG,
    d4Tag: D4_CHANNEL_TAG,
  })

  console.log('D5_REAL_BROWSER_TRANSPORT_RESULTS=' + JSON.stringify(result))
  expect(result.length).toBeGreaterThanOrEqual(4)
  expect(result.filter((item) => !item.ok)).toEqual([])
  expect(result.every((item) => item.bytes !== null && item.bytes > 0)).toBe(true)
})
