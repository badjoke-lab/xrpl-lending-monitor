import type { DbLessBaseManifestV1 } from './base-manifest'
import type { DbLessBaseArtifactReader } from './current-base-reader'
import {
  assertAllowedReleaseResponseOrigin,
  GithubReleaseAssetResolver,
} from '../current-state/http-release-artifact-store'
import { sha256Hex } from '../current-state/canonical-json'

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
