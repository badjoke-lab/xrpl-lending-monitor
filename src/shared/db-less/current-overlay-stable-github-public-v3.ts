/**
 * D5 v3 token-free browser adapter. Explicit candidate only, not used by
 * production static Vault UI. Caller must supply the trusted manifest SHA
 * (from a future verified v3 channel), never discover latest by guessing.
 */
import { sha256Hex } from '../current-state/canonical-json'
import {
  GithubReleaseAssetResolver,
  assertAllowedReleaseResponseOrigin,
} from '../current-state/http-release-artifact-store'
import {
  assertDbLessStableD4CheckpointV3,
  getDbLessStableD4ObjectV3,
  type DbLessStableD4CheckpointV3,
} from './current-overlay-stable-checkpoint-v3'

const TAG = /^d5-stable-d4-v3-(\d+)$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SHA = /^[a-f0-9]{64}$/

async function getExactBytes(
  response: Response,
  limit: number,
  field: string,
): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`D4 v3 ${field} returned HTTP ${response.status}`)
  assertAllowedReleaseResponseOrigin(response.url)
  const header = response.headers.get('content-length')
  if (header !== null && (!Number.isSafeInteger(Number(header)) || Number(header) > limit)) {
    throw new Error(`D4 v3 ${field} exceeds allowed content length`)
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limit) throw new Error(`D4 v3 ${field} exceeds byte budget`)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let count = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    count += value.byteLength
    if (count > limit) {
      await reader.cancel()
      throw new Error(`D4 v3 ${field} exceeded streaming byte budget`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(count)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function openPublicDbLessStableD4CheckpointV3(options: {
  repository: string
  checkpointReleaseTag: string
  throughLedgerIndex: number
  manifestSha256: string
  fetcher?: typeof fetch
}): Promise<{
  manifest: DbLessStableD4CheckpointV3
  get: (objectType: 'vault' | 'loan_broker' | 'loan', objectId: string) => Promise<{
    item: Awaited<ReturnType<typeof getDbLessStableD4ObjectV3>>['item']
    shardReads: number
  }>
}> {
  if (!REPOSITORY.test(options.repository) || !SHA.test(options.manifestSha256)
    || !Number.isSafeInteger(options.throughLedgerIndex)
    || options.throughLedgerIndex < 1
    || options.checkpointReleaseTag !== `d5-stable-d4-v3-${options.throughLedgerIndex}`
    || !TAG.test(options.checkpointReleaseTag)) {
    throw new Error('D4 v3 public checkpoint pointer is not trusted/allowlisted')
  }
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const manifestKey = `current-overlay-v3-${options.throughLedgerIndex}-manifest.json`
  const resolver = new GithubReleaseAssetResolver(options.repository, options.checkpointReleaseTag)
  const response = await fetcher(resolver.urlFor(manifestKey), { redirect: 'follow' })
  const manifestBytes = await getExactBytes(response, 1_000_000, 'manifest')
  if (await sha256Hex(manifestBytes) !== options.manifestSha256) {
    throw new Error('D4 v3 public manifest SHA does not match trusted pointer')
  }
  const source = new TextDecoder('utf-8', {fatal:true}).decode(manifestBytes)
  const manifest = JSON.parse(source) as DbLessStableD4CheckpointV3
  assertDbLessStableD4CheckpointV3(manifest)
  if (manifest.throughLedgerIndex !== options.throughLedgerIndex) {
    throw new Error('D4 v3 public manifest checkpoint ledger mismatch')
  }
  return {
    manifest,
    get: async (objectType, objectId) => getDbLessStableD4ObjectV3({
      manifestBytes,
      manifestSha256: options.manifestSha256,
      objectType,
      objectId,
      readArtifact: async (releaseTag, key) => {
        if (!TAG.test(releaseTag)) {
          throw new Error('D4 v3 public remote Release tag is not allowlisted')
        }
        const assetUrl = new GithubReleaseAssetResolver(options.repository, releaseTag).urlFor(key)
        const res = await fetcher(assetUrl, { redirect: 'follow' })
        return getExactBytes(res, 2_000_000, 'referenced shard')
      },
    }),
  }
}
