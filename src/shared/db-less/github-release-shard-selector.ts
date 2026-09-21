import {
  planDbLessLiveReleaseShard,
  type DbLessLiveReleaseShardPlanV1,
} from './live-release-shard'
import type { GitHubFetchLike } from './github-release-publication'

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

interface GitHubRelease {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
}

interface GitHubReleaseAsset {
  id: number
  name: string
}

function headers(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function releaseForTag(options: {
  repository: string
  releaseTag: string
  token: string
  fetcher: GitHubFetchLike
}): Promise<GitHubRelease | null> {
  const response = await options.fetcher(
    `https://api.github.com/repos/${options.repository}/releases/tags/${encodeURIComponent(options.releaseTag)}`,
    { headers: headers(options.token) },
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`GitHub Release shard lookup failed with HTTP ${response.status}`)
  }
  const release = await response.json() as GitHubRelease
  if (
    !Number.isSafeInteger(release.id)
    || release.id < 1
    || release.tag_name !== options.releaseTag
    || typeof release.draft !== 'boolean'
    || typeof release.prerelease !== 'boolean'
  ) {
    throw new Error('GitHub Release shard response is invalid')
  }
  if (release.draft) throw new Error('DB-less live shard Release must not be a draft')
  if (!release.prerelease) throw new Error('DB-less live shard Release must be a prerelease')
  return release
}

async function releaseAssetCount(options: {
  repository: string
  releaseId: number
  token: string
  fetcher: GitHubFetchLike
}): Promise<number> {
  let count = 0
  for (let page = 1; page <= 10; page += 1) {
    const response = await options.fetcher(
      `https://api.github.com/repos/${options.repository}/releases/${options.releaseId}/assets?per_page=100&page=${page}`,
      { headers: headers(options.token) },
    )
    if (!response.ok) {
      throw new Error(`GitHub Release shard asset lookup failed with HTTP ${response.status}`)
    }
    const values = await response.json() as GitHubReleaseAsset[]
    if (!Array.isArray(values)) throw new Error('GitHub Release shard asset list is invalid')
    for (const asset of values) {
      if (
        !Number.isSafeInteger(asset.id)
        || asset.id < 1
        || typeof asset.name !== 'string'
        || !asset.name.length
      ) {
        throw new Error('GitHub Release shard asset response is invalid')
      }
    }
    count += values.length
    if (values.length < 100) return count
  }
  throw new Error('GitHub Release shard asset pagination exceeded 1000 assets')
}

export interface SelectedDbLessLiveReleaseShardV1 {
  plan: DbLessLiveReleaseShardPlanV1
  releaseExists: boolean
}

export async function selectDbLessLiveReleaseShard(options: {
  repository: string
  tagPrefix: string
  timestamp: string
  plannedArtifacts: number
  token: string
  fetcher?: GitHubFetchLike
  bucketHours?: number
  maxAssets?: number
  maxRotations?: number
}): Promise<SelectedDbLessLiveReleaseShardV1> {
  if (!REPOSITORY.test(options.repository)) {
    throw new Error('GitHub repository must be owner/repository')
  }
  if (!options.token.length) throw new Error('GitHub token must be non-empty')
  const maxRotations = options.maxRotations ?? 24
  if (!Number.isSafeInteger(maxRotations) || maxRotations < 0 || maxRotations > 100) {
    throw new Error('maxRotations must be an integer from 0 through 100')
  }
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))

  for (let rotationIndex = 0; rotationIndex <= maxRotations; rotationIndex += 1) {
    const emptyPlan = planDbLessLiveReleaseShard({
      timestamp: options.timestamp,
      existingAssets: 0,
      plannedArtifacts: options.plannedArtifacts,
      rotationIndex,
      bucketHours: options.bucketHours,
      maxAssets: options.maxAssets,
      tagPrefix: options.tagPrefix,
    })
    if (!emptyPlan.fits) {
      throw new Error('One live publication exceeds the configured Release shard asset ceiling')
    }

    const release = await releaseForTag({
      repository: options.repository,
      releaseTag: emptyPlan.releaseTag,
      token: options.token,
      fetcher,
    })
    if (!release) {
      return { plan: emptyPlan, releaseExists: false }
    }

    const existingAssets = await releaseAssetCount({
      repository: options.repository,
      releaseId: release.id,
      token: options.token,
      fetcher,
    })
    const plan = planDbLessLiveReleaseShard({
      timestamp: options.timestamp,
      existingAssets,
      plannedArtifacts: options.plannedArtifacts,
      rotationIndex,
      bucketHours: options.bucketHours,
      maxAssets: options.maxAssets,
      tagPrefix: options.tagPrefix,
    })
    if (plan.fits) return { plan, releaseExists: true }
  }

  throw new Error('No bounded DB-less live Release shard is available within maxRotations')
}
