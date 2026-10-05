import { describe, expect, it } from 'vitest'

import type { DbLessBaseManifestV1 } from './base-manifest'
import { createGithubReleaseBaseArtifactReader } from './current-base-github-release'
import { sha256Hex } from '../current-state/canonical-json'

describe('DB-less D5 GitHub Release base transport', () => {
  it('reads a public immutable Release asset without a token and verifies it', async () => {
    const bytes = new TextEncoder().encode('fixture')
    const manifest = {
      assets: [{
        key: 'vault-page-000000.json.gz',
        kind: 'vault-page',
        ordinal: 0,
        records: 1,
        bytes: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      }],
    } as DbLessBaseManifestV1

    const seen: Array<{ input: string; init?: RequestInit }> = []
    const reader = createGithubReleaseBaseArtifactReader({
      repository: 'badjoke-lab/xrpl-lending-monitor',
      releaseTag: 'd2-current-base-test',
      manifest,
      fetcher: async (input, init) => {
        seen.push({ input: String(input), init })
        return new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) },
        })
      },
    })

    await expect(reader('vault-page-000000.json.gz')).resolves.toEqual(bytes)
    expect(seen[0]?.input).toContain('/releases/download/d2-current-base-test/')
    expect(seen[0]?.init?.headers).toBeUndefined()
  })
})
