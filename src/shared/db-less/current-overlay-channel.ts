import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const RELEASE_TAG = /^db-less-current-overlay-v1-(\d+)$/
const MANIFEST_KEY = /^current-overlay-v1-(\d+)-manifest\.json$/

export interface DbLessCurrentOverlayLocationV1 {
  provider: 'github-release'
  repository: string
  releaseTag: string
}

export interface DbLessCurrentOverlayPointerV1 {
  location: DbLessCurrentOverlayLocationV1
  manifestKey: string
  manifestSha256: string
  sourceChannelSha256: string
  stateSha256: string
  baseIdentity: string
  throughLedgerIndex: number
  throughLedgerHash: string
  generationCount: number
  entryCount: number
  tombstoneCount: number
  bucketCount: number
}

export interface DbLessCurrentOverlayChannelV1 {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  active: DbLessCurrentOverlayPointerV1
  updatedAt: string
  channelSha256: string
}

export type DbLessCurrentOverlayChannelBodyV1 =
  Omit<DbLessCurrentOverlayChannelV1, 'channelSha256'>

function nonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be non-empty`)
  }
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

function sha256(value: string, field: string): void {
  if (!SHA256.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest`)
  }
}

function assertPointer(pointer: DbLessCurrentOverlayPointerV1): void {
  if (
    !pointer.location
    || pointer.location.provider !== 'github-release'
    || !REPOSITORY.test(pointer.location.repository)
  ) {
    throw new Error('D4 Current overlay location is invalid')
  }

  positiveInteger(pointer.throughLedgerIndex, 'active.throughLedgerIndex')
  if (!LEDGER_HASH.test(pointer.throughLedgerHash)) {
    throw new Error('active.throughLedgerHash must be an uppercase 64-character ledger hash')
  }
  nonEmpty(pointer.baseIdentity, 'active.baseIdentity')
  positiveInteger(pointer.generationCount, 'active.generationCount')
  nonNegativeInteger(pointer.entryCount, 'active.entryCount')
  nonNegativeInteger(pointer.tombstoneCount, 'active.tombstoneCount')
  positiveInteger(pointer.bucketCount, 'active.bucketCount')
  if (pointer.tombstoneCount > pointer.entryCount) {
    throw new Error('active.tombstoneCount exceeds active.entryCount')
  }
  sha256(pointer.manifestSha256, 'active.manifestSha256')
  sha256(pointer.sourceChannelSha256, 'active.sourceChannelSha256')
  sha256(pointer.stateSha256, 'active.stateSha256')

  const releaseMatch = RELEASE_TAG.exec(pointer.location.releaseTag)
  if (!releaseMatch || Number(releaseMatch[1]) !== pointer.throughLedgerIndex) {
    throw new Error('D4 Current overlay Release tag does not match through ledger')
  }
  const manifestMatch = MANIFEST_KEY.exec(pointer.manifestKey)
  if (!manifestMatch || Number(manifestMatch[1]) !== pointer.throughLedgerIndex) {
    throw new Error('D4 Current overlay manifest key does not match through ledger')
  }
}

export function assertDbLessCurrentOverlayChannel(
  channel: DbLessCurrentOverlayChannelV1,
): void {
  if (channel.schemaVersion !== 1) {
    throw new Error('Unsupported D4 Current overlay channel schema version')
  }
  if (channel.network !== 'devnet') {
    throw new Error('D4 Current overlay channel network must be devnet')
  }
  nonEmpty(channel.epochId, 'epochId')
  nonEmpty(channel.updatedAt, 'updatedAt')
  sha256(channel.channelSha256, 'channelSha256')
  assertPointer(channel.active)
}

export async function dbLessCurrentOverlayChannelDigest(
  body: DbLessCurrentOverlayChannelBodyV1,
): Promise<string> {
  return sha256Hex(`${canonicalJson(body)}\n`)
}

export async function buildDbLessCurrentOverlayChannel(
  body: DbLessCurrentOverlayChannelBodyV1,
): Promise<DbLessCurrentOverlayChannelV1> {
  const channel: DbLessCurrentOverlayChannelV1 = {
    ...body,
    channelSha256: await dbLessCurrentOverlayChannelDigest(body),
  }
  assertDbLessCurrentOverlayChannel(channel)
  return channel
}

export async function verifyDbLessCurrentOverlayChannel(
  channel: DbLessCurrentOverlayChannelV1,
): Promise<void> {
  assertDbLessCurrentOverlayChannel(channel)
  const { channelSha256, ...body } = channel
  if (await dbLessCurrentOverlayChannelDigest(body) !== channelSha256) {
    throw new Error('D4 Current overlay channel digest mismatch')
  }
}

export function encodeDbLessCurrentOverlayChannel(
  channel: DbLessCurrentOverlayChannelV1,
): Uint8Array {
  assertDbLessCurrentOverlayChannel(channel)
  return utf8(`${canonicalJson(channel)}\n`)
}
