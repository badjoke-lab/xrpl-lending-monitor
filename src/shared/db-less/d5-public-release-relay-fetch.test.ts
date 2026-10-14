import { describe, expect, it, vi } from 'vitest'
import { sha256Hex, utf8 } from '../current-state/canonical-json'
import { assertAllowedReleaseResponseOrigin } from '../current-state/http-release-artifact-store'
import {
  createDbLessD5PublicRelayFetch,
  mappedDbLessD5ReleaseAsset,
  normalizedDbLessD5RelayOrigin,
} from './d5-public-release-relay-fetch'

const ORIGIN = 'https://xrpl-relay.example.test'
const API = 'https://api.github.com/repos/badjoke-lab/xrpl-lending-monitor/releases/tags/db-less-current-overlay-channel-v1'
const D4 = 'https://github.com/badjoke-lab/xrpl-lending-monitor/releases/download/db-less-current-overlay-v1-6106866/current-overlay-v1-6106866-bucket-0001.json'
const D2 = 'https://github.com/badjoke-lab/xrpl-lending-monitor/releases/download/d2-current-base-35558034659/base-manifest.json'
const D3 = 'https://github.com/badjoke-lab/xrpl-lending-monitor/releases/download/db-less-live-data-v1-20261014-12-r1/live-v1-6106867-6106900-aaaaaaaaaaaaaaaa-cccccccccccc-chunk-0000.json'
function fake(bytes: Uint8Array, url: string): Response {
  const response = new Response(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer, {
    status: 200,
    headers: { 'content-length': String(bytes.length) },
  })
  Object.defineProperty(response,'url',{value:url})
  return response
}

describe('D5 public Release HTTPS relay mapping: candidate only', () => {
  it('routes only exact D2/D3/D4 immutable Release assets, leaving GitHub channel API unchanged', async () => {
    const calls: string[] = []
    const bytes = utf8('immutable bytes\n')
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url)
      calls.push(target)
      return fake(bytes, target)
    }) as unknown as typeof fetch
    const relayFetch = createDbLessD5PublicRelayFetch({ relayOrigin: ORIGIN, fetcher })
    await relayFetch(API)
    for (const item of [D2,D3,D4]) {
      const response = await relayFetch(item)
      expect(await sha256Hex(new Uint8Array(await response.arrayBuffer()))).toBe(await sha256Hex(bytes))
      expect(response.url.startsWith(`${ORIGIN}/artifacts/`)).toBe(true)
      assertAllowedReleaseResponseOrigin(response.url, ORIGIN)
    }
    expect(calls[0]).toBe(API)
    expect(calls.slice(1)).toEqual([D2,D3,D4].map(source=>
      mappedDbLessD5ReleaseAsset({source,relayOrigin:ORIGIN})))
    console.log('D5_RELAY_BROWSER_TRANSPORT_FIXTURE='+JSON.stringify({
      channelApiDirect:true,immutableRequestsRelayed:3,
      shaChecked:true,productionDeployed:false,
    }))
  })

  it('refuses HTTP, path/userinfo/query relay configuration and arbitrary asset URL substitution', () => {
    for (const origin of [
      'http://xrpl-relay.example.test',
      'https://bad:secret@xrpl-relay.example.test',
      'https://xrpl-relay.example.test/artifacts',
      'https://xrpl-relay.example.test/?next=https://evil.example',
      'https://xrpl-relay.example.test/#not-allowed',
    ]) expect(() => normalizedDbLessD5RelayOrigin(origin)).toThrow()
    for(const source of [
      D4.replace('6106866-bucket','6106800-bucket'),
      D4.replace('db-less-current-overlay-v1-', 'db-less-live-data-v1-'),
      D2.replace('/base-manifest.json','/../private.json'),
      D3.replace('live-v1-','../../live-v1-'),
      D4+'?foo=bar',
      'https://github.com/attacker/repo/releases/download/d2-current-base-123/base-manifest.json',
    ]) {
      if (source.includes('/attacker/')) {
        expect(mappedDbLessD5ReleaseAsset({source,relayOrigin:ORIGIN})).toBeNull()
      } else {
        expect(()=>mappedDbLessD5ReleaseAsset({source,relayOrigin:ORIGIN})).toThrow()
      }
    }
  })

  it('does not allow same-origin relay redirects to another path, host or protocol', async () => {
    for(const final of [
      'https://evil.example/artifacts/d2-current-base-35558034659/base-manifest.json',
      'http://xrpl-relay.example.test/artifacts/d2-current-base-35558034659/base-manifest.json',
      `${ORIGIN}/admin`,
      `${ORIGIN}/artifacts/d2-current-base-35558034659/other.json`,
    ]) {
      const transport = vi.fn(async ()=>fake(utf8('x'),final)) as unknown as typeof fetch
      await expect(createDbLessD5PublicRelayFetch({relayOrigin:ORIGIN,fetcher:transport})(D2))
        .rejects.toThrow(/unexpected URL\/origin/)
    }
    expect(()=>assertAllowedReleaseResponseOrigin(`${ORIGIN}/admin`,ORIGIN)).toThrow(/origin/)
    expect(()=>assertAllowedReleaseResponseOrigin(`${ORIGIN}/artifacts/tag/key`)).toThrow(/origin/)
    expect(()=>assertAllowedReleaseResponseOrigin(`${ORIGIN}/artifacts/tag/key`,ORIGIN)).not.toThrow()
  })

  it('fails closed instead of direct CORS fallback and refuses arbitrary GitHub API paths', async () => {
    const transport=vi.fn(async()=>fake(utf8('x'),API)) as unknown as typeof fetch
    const fetcher=createDbLessD5PublicRelayFetch({relayOrigin:ORIGIN,fetcher:transport})
    await expect(fetcher('https://evil.example/data')).rejects.toThrow(/only reads public/)
    await expect(fetcher('https://api.github.com/user')).rejects.toThrow(/only reads public/)
    await expect(fetcher('https://github.com/badjoke-lab/xrpl-lending-monitor/releases/download/d2-current-base-35558034659/bad.txt'))
      .rejects.toThrow(/not allowlisted/)
    expect(transport).not.toHaveBeenCalled()
  })
})
