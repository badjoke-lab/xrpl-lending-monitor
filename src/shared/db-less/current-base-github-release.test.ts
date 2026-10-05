import { describe, expect, it } from 'vitest'

import {
  buildDbLessBaseManifest,
  type DbLessBaseManifestV1,
} from './base-manifest'
import {
  createGithubReleaseBaseArtifactReader,
  openPublicGithubCurrentBase,
} from './current-base-github-release'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'

function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

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
        return withUrl(new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) },
        }), 'https://github.com/badjoke-lab/xrpl-lending-monitor/releases/download/d2-current-base-test/vault-page-000000.json.gz')
      },
    })

    await expect(reader('vault-page-000000.json.gz')).resolves.toEqual(bytes)
    expect(seen[0]?.input).toContain('/releases/download/d2-current-base-test/')
    expect(seen[0]?.init?.headers).toBeUndefined()
  })

  it('opens the verified D2 base manifest from a public Release without a token', async () => {
    const lookupAssets = Array.from({ length: 16 }, (_, ordinal) => ({
      key: `lookup-${ordinal.toString(16).toUpperCase()}.json.gz`,
      kind: 'lookup' as const,
      ordinal,
      records: 0,
      bytes: 1,
      sha256: 'a'.repeat(64),
    }))
    const manifest = await buildDbLessBaseManifest({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'epoch-1',
      snapshotId: 'snapshot-1',
      generationId: 'base-1',
      sourceRevision: 'C'.repeat(40),
      sourceManifestSha256: 'd'.repeat(64),
      ledgerIndex: 100,
      ledgerHash: 'A'.repeat(64),
      complete: true,
      pageSize: 4096,
      lookupPrefixLength: 1,
      counts: { vaults: 0, loanBrokers: 0, loans: 0 },
      pageCounts: { vaults: 0, loanBrokers: 0, loans: 0 },
      assets: lookupAssets,
    })
    const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
    const manifestDigest = await sha256Hex(manifestBytes)
    const seen: Array<{ url: string; authorization: string | null }> = []

    const opened = await openPublicGithubCurrentBase({
      repository: 'badjoke-lab/xrpl-lending-monitor',
      releaseTag: 'd2-current-base-test',
      fetcher: async (input, init) => {
        const url = String(input)
        seen.push({
          url,
          authorization: new Headers(init?.headers).get('authorization'),
        })
        if (url.startsWith('https://api.github.com/')) {
          return withUrl(new Response(JSON.stringify({
            id: 1,
            tag_name: 'd2-current-base-test',
            draft: false,
            prerelease: true,
            assets: [{
              name: 'base-manifest.json',
              size: manifestBytes.byteLength,
              digest: `sha256:${manifestDigest}`,
            }],
          }), { status: 200 }), url)
        }
        const payload = manifestBytes.buffer.slice(
          manifestBytes.byteOffset,
          manifestBytes.byteOffset + manifestBytes.byteLength,
        ) as ArrayBuffer
        return withUrl(new Response(payload, {
          status: 200,
          headers: { 'content-length': String(manifestBytes.byteLength) },
        }), url)
      },
    })

    expect(opened.manifest.generationId).toBe('base-1')
    expect(opened.reader.manifest.manifestSha256).toBe(manifest.manifestSha256)
    expect(seen.every((request) => request.authorization === null)).toBe(true)
  })
})
