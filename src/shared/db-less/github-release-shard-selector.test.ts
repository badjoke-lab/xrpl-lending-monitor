import { describe, expect, it } from 'vitest'

import { selectDbLessLiveReleaseShard } from './github-release-shard-selector'
import type { GitHubFetchLike } from './github-release-publication'

const REPO = 'badjoke-lab/xrpl-lending-monitor'

function fakeGithub(options: {
  assetsByTag: Record<string, number>
}): GitHubFetchLike {
  const releaseIds = new Map<string, number>()
  let nextId = 1
  for (const tag of Object.keys(options.assetsByTag)) releaseIds.set(tag, nextId++)

  return async (input) => {
    const url = new URL(input)
    const tagPrefix = `/repos/${REPO}/releases/tags/`
    if (url.pathname.startsWith(tagPrefix)) {
      const tag = decodeURIComponent(url.pathname.slice(tagPrefix.length))
      const id = releaseIds.get(tag)
      if (!id) return new Response('missing', { status: 404 })
      return Response.json({
        id,
        tag_name: tag,
        draft: false,
        prerelease: true,
      })
    }

    const match = url.pathname.match(new RegExp(`^/repos/${REPO}/releases/(\\d+)/assets$`))
    if (match) {
      const id = Number(match[1])
      const tag = [...releaseIds.entries()].find(([, value]) => value === id)?.[0]
      if (!tag) return new Response('missing', { status: 404 })
      const count = options.assetsByTag[tag] ?? 0
      const page = Number(url.searchParams.get('page') ?? '1')
      const start = (page - 1) * 100
      const length = Math.max(0, Math.min(100, count - start))
      return Response.json(Array.from({ length }, (_, index) => ({
        id: start + index + 1,
        name: `asset-${start + index + 1}.json`,
      })))
    }

    return new Response('unexpected', { status: 404 })
  }
}

describe('GitHub Release live shard selector', () => {
  it('selects a missing primary bucket without mutation', async () => {
    const selected = await selectDbLessLiveReleaseShard({
      repository: REPO,
      tagPrefix: 'db-less-live-data-v1',
      timestamp: '2026-09-20T14:37:00.000Z',
      plannedArtifacts: 5,
      token: 'token',
      fetcher: fakeGithub({ assetsByTag: {} }),
    })

    expect(selected).toMatchObject({
      releaseExists: false,
      plan: {
        releaseTag: 'db-less-live-data-v1-20260920-12',
        existingAssets: 0,
        plannedArtifacts: 5,
        projectedAssets: 5,
        fits: true,
      },
    })
  })

  it('reuses an existing shard when the publication fits', async () => {
    const selected = await selectDbLessLiveReleaseShard({
      repository: REPO,
      tagPrefix: 'db-less-live-data-v1',
      timestamp: '2026-09-20T14:37:00.000Z',
      plannedArtifacts: 5,
      token: 'token',
      fetcher: fakeGithub({
        assetsByTag: { 'db-less-live-data-v1-20260920-12': 700 },
      }),
    })

    expect(selected.plan.releaseTag).toBe('db-less-live-data-v1-20260920-12')
    expect(selected.plan.projectedAssets).toBe(705)
    expect(selected.releaseExists).toBe(true)
  })

  it('rotates when the primary shard would cross the ceiling', async () => {
    const selected = await selectDbLessLiveReleaseShard({
      repository: REPO,
      tagPrefix: 'db-less-live-data-v1',
      timestamp: '2026-09-20T14:37:00.000Z',
      plannedArtifacts: 5,
      token: 'token',
      fetcher: fakeGithub({
        assetsByTag: {
          'db-less-live-data-v1-20260920-12': 718,
          'db-less-live-data-v1-20260920-12-r1': 719,
        },
      }),
    })

    expect(selected).toMatchObject({
      releaseExists: false,
      plan: {
        rotationIndex: 2,
        releaseTag: 'db-less-live-data-v1-20260920-12-r2',
        existingAssets: 0,
        projectedAssets: 5,
        fits: true,
      },
    })
  })

  it('fails closed when one publication cannot fit any shard', async () => {
    await expect(selectDbLessLiveReleaseShard({
      repository: REPO,
      tagPrefix: 'db-less-live-data-v1',
      timestamp: '2026-09-20T14:37:00.000Z',
      plannedArtifacts: 721,
      token: 'token',
      fetcher: fakeGithub({ assetsByTag: {} }),
    })).rejects.toThrow('exceeds')
  })
})