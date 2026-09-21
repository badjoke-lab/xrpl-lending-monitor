import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  assertDbLessArtifactLocation,
  type DbLessArtifactLocationV1,
  type DbLessLivePointerV1,
} from './channel'
import {
  assertDbLessLiveDeltaManifest,
  type DbLessArtifact,
  type DbLessLiveDeltaManifestV1,
} from './live-delta'

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const PORTABLE_DIGEST = /^sha256:[a-f0-9]{64}$/

export interface DbLessLiveChainDeltaV1 {
  location: DbLessArtifactLocationV1
  generationId: string
  manifestKey: string
  manifestSha256: string
  payloadDigest: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  startLedgerHash: string
  endLedgerIndex: number
  endLedgerHash: string
  ledgerCount: number
}

export interface DbLessLiveChainPreviousV1 extends DbLessLivePointerV1 {
  generationCount: number
  ledgerCount: number
}

export interface DbLessLiveChainManifestV1 {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  baseIdentity: string
  baseLedgerIndex: number
  baseLedgerHash: string
  publicationLocation: DbLessArtifactLocationV1
  generationId: string
  generatedAt: string
  generationCount: number
  startLedgerIndex: number
  startLedgerHash: string
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
  ledgerCount: number
  previous: DbLessLiveChainPreviousV1 | null
  delta: DbLessLiveChainDeltaV1
  chainDigest: string
}

type DbLessLiveChainDigestBodyV1 = Omit<
  DbLessLiveChainManifestV1,
  'generationId' | 'chainDigest'
>

export interface DbLessLiveChainArtifactSet {
  manifest: DbLessLiveChainManifestV1
  manifestArtifact: DbLessArtifact
  channelPointer: DbLessLivePointerV1
}

function nonEmpty(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must be non-empty`)
}

function safeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be a safe integer of at least ${minimum}`)
  }
}

function ledgerHash(value: string, field: string): void {
  if (!LEDGER_HASH.test(value)) {
    throw new Error(`${field} must be an uppercase 64-character ledger hash`)
  }
}

function sha256(value: string, field: string): void {
  if (!SHA256.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest`)
  }
}

function portableDigest(value: string, field: string): void {
  if (!PORTABLE_DIGEST.test(value)) {
    throw new Error(`${field} must be a portable SHA-256 digest`)
  }
}

function safeKey(value: string, field: string): void {
  nonEmpty(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${field} must be a flat GitHub Release asset name`)
  }
}

function assertLivePointer(pointer: DbLessLivePointerV1, field: string): void {
  assertDbLessArtifactLocation(pointer.location, `${field}.location`)
  nonEmpty(pointer.generationId, `${field}.generationId`)
  safeKey(pointer.manifestKey, `${field}.manifestKey`)
  sha256(pointer.manifestSha256, `${field}.manifestSha256`)
  portableDigest(pointer.payloadDigest, `${field}.payloadDigest`)
  safeInteger(pointer.startLedgerIndex, `${field}.startLedgerIndex`, 1)
  safeInteger(pointer.endLedgerIndex, `${field}.endLedgerIndex`, 1)
  ledgerHash(pointer.startLedgerHash, `${field}.startLedgerHash`)
  ledgerHash(pointer.startParentHash, `${field}.startParentHash`)
  ledgerHash(pointer.endLedgerHash, `${field}.endLedgerHash`)
  if (pointer.endLedgerIndex < pointer.startLedgerIndex) {
    throw new Error(`${field}.endLedgerIndex precedes startLedgerIndex`)
  }
}

function assertPrevious(pointer: DbLessLiveChainPreviousV1): void {
  assertLivePointer(pointer, 'previous')
  safeInteger(pointer.generationCount, 'previous.generationCount', 1)
  safeInteger(pointer.ledgerCount, 'previous.ledgerCount', 1)
}

function assertDelta(delta: DbLessLiveChainDeltaV1): void {
  assertDbLessArtifactLocation(delta.location, 'delta.location')
  nonEmpty(delta.generationId, 'delta.generationId')
  safeKey(delta.manifestKey, 'delta.manifestKey')
  sha256(delta.manifestSha256, 'delta.manifestSha256')
  portableDigest(delta.payloadDigest, 'delta.payloadDigest')
  safeInteger(delta.previousLedgerIndex, 'delta.previousLedgerIndex')
  safeInteger(delta.startLedgerIndex, 'delta.startLedgerIndex', 1)
  safeInteger(delta.endLedgerIndex, 'delta.endLedgerIndex', 1)
  safeInteger(delta.ledgerCount, 'delta.ledgerCount', 1)
  ledgerHash(delta.expectedParentHash, 'delta.expectedParentHash')
  ledgerHash(delta.startLedgerHash, 'delta.startLedgerHash')
  ledgerHash(delta.endLedgerHash, 'delta.endLedgerHash')
  if (delta.startLedgerIndex !== delta.previousLedgerIndex + 1) {
    throw new Error('Live chain delta must start at previous ledger + 1')
  }
  if (delta.endLedgerIndex < delta.startLedgerIndex) {
    throw new Error('Live chain delta ends before it starts')
  }
  if (delta.ledgerCount !== delta.endLedgerIndex - delta.startLedgerIndex + 1) {
    throw new Error('Live chain delta ledger count does not match its range')
  }
}

function deltaPointer(options: {
  location: DbLessArtifactLocationV1
  manifest: DbLessLiveDeltaManifestV1
  manifestArtifact: DbLessArtifact
}): DbLessLiveChainDeltaV1 {
  const { location, manifest, manifestArtifact } = options
  assertDbLessArtifactLocation(location, 'delta.location')
  assertDbLessLiveDeltaManifest(manifest)
  if (manifestArtifact.immutable !== true) {
    throw new Error('Live delta manifest artifact must be immutable')
  }
  if (manifestArtifact.mediaType !== 'application/json') {
    throw new Error('Live delta manifest artifact media type must be application/json')
  }
  const expectedKey = `${manifest.generationId}-manifest.json`
  if (manifestArtifact.key !== expectedKey) {
    throw new Error('Live delta manifest artifact key does not match its generation')
  }
  return {
    location,
    generationId: manifest.generationId,
    manifestKey: manifestArtifact.key,
    manifestSha256: manifestArtifact.sha256,
    payloadDigest: manifest.payloadDigest,
    previousLedgerIndex: manifest.previousLedgerIndex,
    expectedParentHash: manifest.expectedParentHash,
    startLedgerIndex: manifest.startLedgerIndex,
    startLedgerHash: manifest.startLedgerHash,
    endLedgerIndex: manifest.endLedgerIndex,
    endLedgerHash: manifest.endLedgerHash,
    ledgerCount: manifest.ledgerCount,
  }
}

function digestBody(manifest: DbLessLiveChainManifestV1): DbLessLiveChainDigestBodyV1 {
  const { generationId: _generationId, chainDigest: _chainDigest, ...body } = manifest
  return body
}

async function chainDigest(body: DbLessLiveChainDigestBodyV1): Promise<string> {
  return `sha256:${await sha256Hex(`${canonicalJson(body)}\n`)}`
}

function expectedGenerationId(manifest: {
  startLedgerIndex: number
  endLedgerIndex: number
  chainDigest: string
}): string {
  portableDigest(manifest.chainDigest, 'chainDigest')
  return [
    'live-chain-v1',
    manifest.startLedgerIndex,
    manifest.endLedgerIndex,
    manifest.chainDigest.slice('sha256:'.length, 'sha256:'.length + 16),
  ].join('-')
}

async function pointerFromManifest(
  manifest: DbLessLiveChainManifestV1,
): Promise<DbLessLiveChainPreviousV1> {
  await verifyDbLessLiveChainManifest(manifest)
  const bytes = utf8(`${canonicalJson(manifest)}\n`)
  return {
    location: manifest.publicationLocation,
    generationId: manifest.generationId,
    manifestKey: `${manifest.generationId}-manifest.json`,
    manifestSha256: await sha256Hex(bytes),
    payloadDigest: manifest.chainDigest,
    startLedgerIndex: manifest.startLedgerIndex,
    startLedgerHash: manifest.startLedgerHash,
    startParentHash: manifest.startParentHash,
    endLedgerIndex: manifest.endLedgerIndex,
    endLedgerHash: manifest.endLedgerHash,
    generationCount: manifest.generationCount,
    ledgerCount: manifest.ledgerCount,
  }
}

export function assertDbLessLiveChainManifest(manifest: DbLessLiveChainManifestV1): void {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported DB-less live chain schema version')
  if (manifest.network !== 'devnet') throw new Error('DB-less live chain network must be devnet')
  nonEmpty(manifest.epochId, 'epochId')
  nonEmpty(manifest.baseIdentity, 'baseIdentity')
  nonEmpty(manifest.generationId, 'generationId')
  nonEmpty(manifest.generatedAt, 'generatedAt')
  assertDbLessArtifactLocation(manifest.publicationLocation, 'publicationLocation')
  safeInteger(manifest.baseLedgerIndex, 'baseLedgerIndex', 1)
  safeInteger(manifest.generationCount, 'generationCount', 1)
  safeInteger(manifest.startLedgerIndex, 'startLedgerIndex', 1)
  safeInteger(manifest.endLedgerIndex, 'endLedgerIndex', 1)
  safeInteger(manifest.ledgerCount, 'ledgerCount', 1)
  ledgerHash(manifest.baseLedgerHash, 'baseLedgerHash')
  ledgerHash(manifest.startLedgerHash, 'startLedgerHash')
  ledgerHash(manifest.startParentHash, 'startParentHash')
  ledgerHash(manifest.endLedgerHash, 'endLedgerHash')
  portableDigest(manifest.chainDigest, 'chainDigest')
  assertDelta(manifest.delta)
  if (manifest.previous !== null) assertPrevious(manifest.previous)

  if (manifest.startLedgerIndex !== manifest.baseLedgerIndex + 1) {
    throw new Error('Live chain must start immediately after the base ledger')
  }
  if (manifest.startParentHash !== manifest.baseLedgerHash) {
    throw new Error('Live chain parent hash must match the base ledger hash')
  }
  if (manifest.endLedgerIndex !== manifest.delta.endLedgerIndex) {
    throw new Error('Live chain end ledger must match the current delta')
  }
  if (manifest.endLedgerHash !== manifest.delta.endLedgerHash) {
    throw new Error('Live chain end hash must match the current delta')
  }

  if (manifest.previous === null) {
    if (manifest.generationCount !== 1) {
      throw new Error('First live chain generationCount must be 1')
    }
    if (manifest.delta.previousLedgerIndex !== manifest.baseLedgerIndex) {
      throw new Error('First live delta previous ledger must match the base ledger')
    }
    if (manifest.delta.startLedgerIndex !== manifest.startLedgerIndex) {
      throw new Error('First live delta must start at the live chain start')
    }
    if (manifest.delta.startLedgerHash !== manifest.startLedgerHash) {
      throw new Error('First live delta start hash must match the live chain start hash')
    }
    if (manifest.delta.expectedParentHash !== manifest.baseLedgerHash) {
      throw new Error('First live delta parent hash must match the base ledger hash')
    }
    if (manifest.ledgerCount !== manifest.delta.ledgerCount) {
      throw new Error('First live chain ledger count must match its delta')
    }
  } else {
    if (manifest.generationCount !== manifest.previous.generationCount + 1) {
      throw new Error('Linked live chain generationCount must increment previous generationCount by 1')
    }
    if (manifest.previous.startLedgerIndex !== manifest.startLedgerIndex) {
      throw new Error('Previous live chain start ledger does not match')
    }
    if (manifest.previous.startParentHash !== manifest.startParentHash) {
      throw new Error('Previous live chain start parent hash does not match')
    }
    if (manifest.previous.startLedgerHash !== manifest.startLedgerHash) {
      throw new Error('Previous live chain start hash does not match')
    }
    if (manifest.delta.previousLedgerIndex !== manifest.previous.endLedgerIndex) {
      throw new Error('Live chain delta previous ledger does not match prior head')
    }
    if (manifest.delta.expectedParentHash !== manifest.previous.endLedgerHash) {
      throw new Error('Live chain delta parent hash does not match prior head')
    }
    if (manifest.ledgerCount !== manifest.previous.ledgerCount + manifest.delta.ledgerCount) {
      throw new Error('Linked live chain cumulative ledger count must equal previous + current delta')
    }
  }

  if (manifest.generationId !== expectedGenerationId(manifest)) {
    throw new Error('Live chain generation ID does not match its digest and range')
  }
}

export async function verifyDbLessLiveChainManifest(
  manifest: DbLessLiveChainManifestV1,
): Promise<void> {
  assertDbLessLiveChainManifest(manifest)
  if (await chainDigest(digestBody(manifest)) !== manifest.chainDigest) {
    throw new Error('DB-less live chain digest mismatch')
  }
}

export async function buildDbLessLiveChainArtifacts(options: {
  epochId: string
  baseIdentity: string
  baseLedgerIndex: number
  baseLedgerHash: string
  publicationLocation: DbLessArtifactLocationV1
  previousChain?: DbLessLiveChainManifestV1 | null
  deltaManifest: DbLessLiveDeltaManifestV1
  deltaManifestArtifact: DbLessArtifact
}): Promise<DbLessLiveChainArtifactSet> {
  nonEmpty(options.epochId, 'epochId')
  nonEmpty(options.baseIdentity, 'baseIdentity')
  safeInteger(options.baseLedgerIndex, 'baseLedgerIndex', 1)
  ledgerHash(options.baseLedgerHash, 'baseLedgerHash')
  assertDbLessArtifactLocation(options.publicationLocation, 'publicationLocation')

  const declaredArtifactSha256 = await sha256Hex(options.deltaManifestArtifact.bytes)
  if (declaredArtifactSha256 !== options.deltaManifestArtifact.sha256) {
    throw new Error('Live delta manifest artifact digest does not match its bytes')
  }
  const expectedManifestBytes = utf8(`${canonicalJson(options.deltaManifest)}\n`)
  if (await sha256Hex(expectedManifestBytes) !== options.deltaManifestArtifact.sha256) {
    throw new Error('Live delta manifest artifact does not encode the supplied manifest')
  }

  if (options.deltaManifest.epochId !== options.epochId) {
    throw new Error('Live delta epoch does not match live chain epoch')
  }
  if (options.deltaManifest.baseIdentity !== options.baseIdentity) {
    throw new Error('Live delta base identity does not match live chain base')
  }

  const delta = deltaPointer({
    location: options.publicationLocation,
    manifest: options.deltaManifest,
    manifestArtifact: options.deltaManifestArtifact,
  })

  let previous: DbLessLiveChainPreviousV1 | null = null
  let generationCount = 1
  let startLedgerHash = delta.startLedgerHash
  let cumulativeLedgerCount = delta.ledgerCount

  if (options.previousChain) {
    await verifyDbLessLiveChainManifest(options.previousChain)
    if (
      options.previousChain.epochId !== options.epochId
      || options.previousChain.baseIdentity !== options.baseIdentity
      || options.previousChain.baseLedgerIndex !== options.baseLedgerIndex
      || options.previousChain.baseLedgerHash !== options.baseLedgerHash
    ) {
      throw new Error('Previous live chain does not match the requested base context')
    }

    previous = await pointerFromManifest(options.previousChain)
    generationCount = options.previousChain.generationCount + 1
    startLedgerHash = options.previousChain.startLedgerHash
    cumulativeLedgerCount = options.previousChain.ledgerCount + delta.ledgerCount
  }

  const body: DbLessLiveChainDigestBodyV1 = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: options.epochId,
    baseIdentity: options.baseIdentity,
    baseLedgerIndex: options.baseLedgerIndex,
    baseLedgerHash: options.baseLedgerHash,
    publicationLocation: options.publicationLocation,
    generatedAt: options.deltaManifest.generatedAt,
    generationCount,
    startLedgerIndex: options.baseLedgerIndex + 1,
    startLedgerHash,
    startParentHash: options.baseLedgerHash,
    endLedgerIndex: delta.endLedgerIndex,
    endLedgerHash: delta.endLedgerHash,
    ledgerCount: cumulativeLedgerCount,
    previous,
    delta,
  }
  const digest = await chainDigest(body)
  const manifest: DbLessLiveChainManifestV1 = {
    ...body,
    generationId: expectedGenerationId({
      startLedgerIndex: body.startLedgerIndex,
      endLedgerIndex: body.endLedgerIndex,
      chainDigest: digest,
    }),
    chainDigest: digest,
  }
  await verifyDbLessLiveChainManifest(manifest)

  const bytes = utf8(`${canonicalJson(manifest)}\n`)
  const manifestArtifact: DbLessArtifact = {
    key: `${manifest.generationId}-manifest.json`,
    mediaType: 'application/json',
    bytes,
    sha256: await sha256Hex(bytes),
    immutable: true,
  }
  const channelPointer: DbLessLivePointerV1 = {
    location: options.publicationLocation,
    generationId: manifest.generationId,
    manifestKey: manifestArtifact.key,
    manifestSha256: manifestArtifact.sha256,
    payloadDigest: manifest.chainDigest,
    startLedgerIndex: manifest.startLedgerIndex,
    startLedgerHash: manifest.startLedgerHash,
    startParentHash: manifest.startParentHash,
    endLedgerIndex: manifest.endLedgerIndex,
    endLedgerHash: manifest.endLedgerHash,
  }

  return { manifest, manifestArtifact, channelPointer }
}