import {
  verifyDbLessBaseManifest,
  type DbLessBaseManifestV1,
} from './base-manifest'
import {
  DbLessCurrentBaseReader,
  type DbLessBaseArtifactReader,
} from './current-base-reader'
import {
  assertAllowedReleaseResponseOrigin,
  GithubReleaseAssetResolver,
} from '../current-state/http-release-artifact-store'
import { sha256Hex } from '../current-state/canonical-json'

const DEFAULT_MAX_MANIFEST_BYTES = 1_000_000

interface GitHubReleaseAsset {
  name: string
  size: number
  digest: string | null
}

interface GitHubRelease {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: GitHubReleaseAsset[]
}

function repository(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('GitHub repository must be owner/name')
  }
  return value
}

function releaseTag(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error('GitHub Release tag is invalid')
  }
  return value
}

function assertApiOrigin(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com') {
    throw new Error('GitHub Release API response origin is invalid')
  }
}

export function createGithubReleaseBaseArtifactReader(options: {
  repository: string
  releaseTag: string
  manifest: DbLessBaseManifestV1
  fetcher?: typeof fetch
}): DbLessBaseArtifactReader {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const resolver = new GithubReleaseAssetResolver(options.repository, options.releaseTag)
  const descriptors = new Map(options.manifest.assets.map((asset) => [asset.key, asset]))

  return async (key: string) => {
    const descriptor = descriptors.get(key)
    if (!descriptor) return null
    const response = await fetcher(resolver.urlFor(key), { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`DB-less base Release asset fetch failed with ${response.status}`)
    }
    assertAllowedReleaseResponseOrigin(response.url)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== descriptor.bytes) {
      throw new Error(`DB-less base Release asset size mismatch: ${key}`)
    }
    if (await sha256Hex(bytes) !== descriptor.sha256) {
      throw new Error(`DB-less base Release asset digest mismatch: ${key}`)
    }
    return bytes
  }
}

export interface PublicCurrentBaseOpenResult {
  manifest: DbLessBaseManifestV1
  reader: DbLessCurrentBaseReader
}

export async function openPublicGithubCurrentBase(options: {
  repository: string
  releaseTag: string
  fetcher?: typeof fetch
  maxManifestBytes?: number
  maxAssetBytes?: number
}): Promise<PublicCurrentBaseOpenResult> {
  const repo = repository(options.repository)
  const tag = releaseTag(options.releaseTag)
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const releaseResponse = await fetcher(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!releaseResponse.ok) {
    throw new Error(`DB-less base Release metadata fetch failed with ${releaseResponse.status}`)
  }
  assertApiOrigin(releaseResponse.url)
  const release = await releaseResponse.json() as GitHubRelease
  if (
    !Number.isSafeInteger(release.id)
    || release.id < 1
    || release.tag_name !== tag
    || release.draft
    || !release.prerelease
    || !Array.isArray(release.assets)
  ) {
    throw new Error('DB-less base Release metadata is invalid')
  }

  const matches = release.assets.filter((asset) => asset.name === 'base-manifest.json')
  if (matches.length !== 1) {
    throw new Error('DB-less base Release must contain exactly one base-manifest.json asset')
  }
  const manifestAsset = matches[0]!
  const expectedDigest = manifestAsset.digest?.startsWith('sha256:')
    ? manifestAsset.digest.slice('sha256:'.length)
    : null
  if (!expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error('DB-less base manifest Release digest is unavailable')
  }
  const maxManifestBytes = options.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES
  if (
    !Number.isSafeInteger(manifestAsset.size)
    || manifestAsset.size < 1
    || manifestAsset.size > maxManifestBytes
  ) {
    throw new Error('DB-less base manifest Release size is invalid')
  }

  const resolver = new GithubReleaseAssetResolver(repo, tag)
  const manifestResponse = await fetcher(
    resolver.urlFor(manifestAsset.name),
    { redirect: 'follow' },
  )
  if (!manifestResponse.ok) {
    throw new Error(`DB-less base manifest fetch failed with ${manifestResponse.status}`)
  }
  assertAllowedReleaseResponseOrigin(manifestResponse.url)
  const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer())
  if (manifestBytes.byteLength !== manifestAsset.size) {
    throw new Error('DB-less base manifest byte size mismatch')
  }
  if (await sha256Hex(manifestBytes) !== expectedDigest) {
    throw new Error('DB-less base manifest Release digest mismatch')
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as DbLessBaseManifestV1
  await verifyDbLessBaseManifest(manifest)

  const reader = new DbLessCurrentBaseReader({
    manifest,
    maxAssetBytes: options.maxAssetBytes,
    readArtifact: createGithubReleaseBaseArtifactReader({
      repository: repo,
      releaseTag: tag,
      manifest,
      fetcher,
    }),
  })
  return { manifest, reader }
}
