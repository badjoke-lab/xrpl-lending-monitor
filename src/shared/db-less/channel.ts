import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const PORTABLE_DIGEST = /^sha256:[a-f0-9]{64}$/

export interface DbLessBasePointerV1 {
  generationId: string
  snapshotId: string
  manifestKey: string
  manifestSha256: string
  ledgerIndex: number
  ledgerHash: string
}

export interface DbLessLivePointerV1 {
  generationId: string
  manifestKey: string
  manifestSha256: string
  payloadDigest: string
  startLedgerIndex: number
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
}

export interface DbLessHistoryCoverageRangeV1 {
  rangeId: string
  source: 'archive' | 'live'
  epochId: string
  startLedgerIndex: number
  startLedgerHash: string
  endLedgerIndex: number
  endLedgerHash: string
}

export interface DbLessChannelV1 {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  base: DbLessBasePointerV1
  live: DbLessLivePointerV1 | null
  lastCommittedLedgerIndex: number
  lastCommittedLedgerHash: string
  historyCoverage: DbLessHistoryCoverageRangeV1[]
  updatedAt: string
  channelSha256: string
}

export type DbLessChannelBodyV1 = Omit<DbLessChannelV1, 'channelSha256'>

function nonEmpty(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must be non-empty`)
}

function safeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be a safe integer of at least ${minimum}`)
  }
}

function ledgerHash(value: string, field: string): void {
  if (!LEDGER_HASH.test(value)) throw new Error(`${field} must be an uppercase 64-character ledger hash`)
}

function sha256(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`)
}

function payloadDigest(value: string, field: string): void {
  if (!PORTABLE_DIGEST.test(value)) throw new Error(`${field} must be a portable SHA-256 digest`)
}

function safeKey(value: string, field: string): void {
  nonEmpty(value, field)
  if (
    value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) throw new Error(`${field} is unsafe`)
}

function assertBase(base: DbLessBasePointerV1): void {
  nonEmpty(base.generationId, 'base.generationId')
  nonEmpty(base.snapshotId, 'base.snapshotId')
  safeKey(base.manifestKey, 'base.manifestKey')
  sha256(base.manifestSha256, 'base.manifestSha256')
  safeInteger(base.ledgerIndex, 'base.ledgerIndex', 1)
  ledgerHash(base.ledgerHash, 'base.ledgerHash')
}

function assertLive(live: DbLessLivePointerV1): void {
  nonEmpty(live.generationId, 'live.generationId')
  safeKey(live.manifestKey, 'live.manifestKey')
  sha256(live.manifestSha256, 'live.manifestSha256')
  payloadDigest(live.payloadDigest, 'live.payloadDigest')
  safeInteger(live.startLedgerIndex, 'live.startLedgerIndex', 1)
  safeInteger(live.endLedgerIndex, 'live.endLedgerIndex', 1)
  ledgerHash(live.startParentHash, 'live.startParentHash')
  ledgerHash(live.endLedgerHash, 'live.endLedgerHash')
  if (live.endLedgerIndex < live.startLedgerIndex) {
    throw new Error('live.endLedgerIndex precedes live.startLedgerIndex')
  }
}

function assertCoverage(ranges: readonly DbLessHistoryCoverageRangeV1[]): void {
  const byEpoch = new Map<string, DbLessHistoryCoverageRangeV1[]>()
  for (const [index, range] of ranges.entries()) {
    nonEmpty(range.rangeId, `historyCoverage[${index}].rangeId`)
    if (range.source !== 'archive' && range.source !== 'live') {
      throw new Error('historyCoverage source is invalid')
    }
    nonEmpty(range.epochId, `historyCoverage[${index}].epochId`)
    safeInteger(range.startLedgerIndex, `historyCoverage[${index}].startLedgerIndex`, 1)
    safeInteger(range.endLedgerIndex, `historyCoverage[${index}].endLedgerIndex`, 1)
    ledgerHash(range.startLedgerHash, `historyCoverage[${index}].startLedgerHash`)
    ledgerHash(range.endLedgerHash, `historyCoverage[${index}].endLedgerHash`)
    if (range.endLedgerIndex < range.startLedgerIndex) {
      throw new Error('historyCoverage range end precedes its start')
    }
    const epochRanges = byEpoch.get(range.epochId) ?? []
    epochRanges.push(range)
    byEpoch.set(range.epochId, epochRanges)
  }

  for (const epochRanges of byEpoch.values()) {
    epochRanges.sort((left, right) => left.startLedgerIndex - right.startLedgerIndex)
    for (let index = 1; index < epochRanges.length; index += 1) {
      const previous = epochRanges[index - 1]!
      const current = epochRanges[index]!
      if (current.startLedgerIndex <= previous.endLedgerIndex) {
        throw new Error('historyCoverage ranges must not overlap within an epoch')
      }
    }
  }
}

export function assertDbLessChannel(channel: DbLessChannelV1): void {
  if (channel.schemaVersion !== 1) throw new Error('Unsupported DB-less channel schema version')
  if (channel.network !== 'devnet') throw new Error('DB-less channel network must be devnet')
  nonEmpty(channel.epochId, 'epochId')
  nonEmpty(channel.updatedAt, 'updatedAt')
  sha256(channel.channelSha256, 'channelSha256')
  assertBase(channel.base)
  assertCoverage(channel.historyCoverage)

  if (channel.live === null) {
    if (
      channel.lastCommittedLedgerIndex !== channel.base.ledgerIndex
      || channel.lastCommittedLedgerHash !== channel.base.ledgerHash
    ) {
      throw new Error('Channel without live data must commit exactly the base ledger')
    }
    return
  }

  assertLive(channel.live)
  if (channel.live.startLedgerIndex !== channel.base.ledgerIndex + 1) {
    throw new Error('Live generation must start immediately after the active base')
  }
  if (channel.live.startParentHash !== channel.base.ledgerHash) {
    throw new Error('Live generation parent hash must match the active base hash')
  }
  if (
    channel.lastCommittedLedgerIndex !== channel.live.endLedgerIndex
    || channel.lastCommittedLedgerHash !== channel.live.endLedgerHash
  ) {
    throw new Error('Channel committed head must match the active live generation')
  }
}

export async function dbLessChannelDigest(body: DbLessChannelBodyV1): Promise<string> {
  return sha256Hex(`${canonicalJson(body)}\n`)
}

export async function buildDbLessChannel(body: DbLessChannelBodyV1): Promise<DbLessChannelV1> {
  const channel: DbLessChannelV1 = {
    ...body,
    channelSha256: await dbLessChannelDigest(body),
  }
  assertDbLessChannel(channel)
  return channel
}

export async function verifyDbLessChannel(channel: DbLessChannelV1): Promise<void> {
  assertDbLessChannel(channel)
  const { channelSha256, ...body } = channel
  if (await dbLessChannelDigest(body) !== channelSha256) {
    throw new Error('DB-less channel digest mismatch')
  }
}

export function encodeDbLessChannel(channel: DbLessChannelV1): Uint8Array {
  assertDbLessChannel(channel)
  return utf8(`${canonicalJson(channel)}\n`)
}
