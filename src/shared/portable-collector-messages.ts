import { canonicalPortableJson } from './portable-collector-reference-store'

export const PORTABLE_PHASE_MESSAGE_SCHEMA_VERSION = 1 as const
export const PORTABLE_PHASE_MESSAGE_MAX_BYTES = 16_000

export interface ScanPhaseMessageV1 {
  schemaVersion: 1
  phase: 'scan'
  messageId: string
  network: string
  epochId: string
  baseIdentity: string
  expectedPreviousLedgerIndex: number
  expectedPreviousLedgerHash: string
}

export interface CommitPhaseMessageV1 {
  schemaVersion: 1
  phase: 'commit'
  messageId: string
  workId: string
  chunkIndex: number
}

export interface FinalizePhaseMessageV1 {
  schemaVersion: 1
  phase: 'finalize'
  messageId: string
  workId: string
}

export type PortableCollectorPhaseMessageV1 =
  | ScanPhaseMessageV1
  | CommitPhaseMessageV1
  | FinalizePhaseMessageV1

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function requiredNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function encoded(value: string): string {
  return encodeURIComponent(value)
}

function canonicalHash(value: string, name: string): string {
  return requiredString(value, name).toUpperCase()
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${name} contains unexpected or missing fields`)
  }
}

export function buildScanPhaseMessage(input: {
  network: string
  epochId: string
  baseIdentity: string
  expectedPreviousLedgerIndex: number
  expectedPreviousLedgerHash: string
}): ScanPhaseMessageV1 {
  const network = requiredString(input.network, 'network')
  const epochId = requiredString(input.epochId, 'epochId')
  const baseIdentity = requiredString(input.baseIdentity, 'baseIdentity')
  const expectedPreviousLedgerIndex = requiredNonNegativeInteger(
    input.expectedPreviousLedgerIndex,
    'expectedPreviousLedgerIndex',
  )
  const expectedPreviousLedgerHash = canonicalHash(
    input.expectedPreviousLedgerHash,
    'expectedPreviousLedgerHash',
  )
  const messageId = [
    'scan',
    'v1',
    encoded(network),
    encoded(epochId),
    encoded(baseIdentity),
    String(expectedPreviousLedgerIndex),
    encoded(expectedPreviousLedgerHash),
  ].join(':')

  return {
    schemaVersion: PORTABLE_PHASE_MESSAGE_SCHEMA_VERSION,
    phase: 'scan',
    messageId,
    network,
    epochId,
    baseIdentity,
    expectedPreviousLedgerIndex,
    expectedPreviousLedgerHash,
  }
}

export function buildCommitPhaseMessage(input: {
  workId: string
  chunkIndex: number
}): CommitPhaseMessageV1 {
  const workId = requiredString(input.workId, 'workId')
  const chunkIndex = requiredNonNegativeInteger(input.chunkIndex, 'chunkIndex')
  return {
    schemaVersion: PORTABLE_PHASE_MESSAGE_SCHEMA_VERSION,
    phase: 'commit',
    messageId: ['commit', 'v1', encoded(workId), String(chunkIndex)].join(':'),
    workId,
    chunkIndex,
  }
}

export function buildFinalizePhaseMessage(input: {
  workId: string
}): FinalizePhaseMessageV1 {
  const workId = requiredString(input.workId, 'workId')
  return {
    schemaVersion: PORTABLE_PHASE_MESSAGE_SCHEMA_VERSION,
    phase: 'finalize',
    messageId: ['finalize', 'v1', encoded(workId)].join(':'),
    workId,
  }
}

export function encodePortablePhaseMessage(message: PortableCollectorPhaseMessageV1): string {
  const validated = validatePortablePhaseMessage(message)
  const encodedMessage = canonicalPortableJson(validated)
  const byteLength = new TextEncoder().encode(encodedMessage).byteLength
  if (byteLength > PORTABLE_PHASE_MESSAGE_MAX_BYTES) {
    throw new Error(
      `portable phase message exceeds ${PORTABLE_PHASE_MESSAGE_MAX_BYTES} bytes: ${byteLength}`,
    )
  }
  return encodedMessage
}

export function parsePortablePhaseMessage(payloadJson: string): PortableCollectorPhaseMessageV1 {
  const byteLength = new TextEncoder().encode(payloadJson).byteLength
  if (byteLength > PORTABLE_PHASE_MESSAGE_MAX_BYTES) {
    throw new Error(
      `portable phase message exceeds ${PORTABLE_PHASE_MESSAGE_MAX_BYTES} bytes: ${byteLength}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    throw new Error('portable phase message is not valid JSON')
  }
  return validatePortablePhaseMessage(parsed)
}

export function validatePortablePhaseMessage(
  value: unknown,
): PortableCollectorPhaseMessageV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('portable phase message must be an object')
  }
  const message = value as Record<string, unknown>
  if (message.schemaVersion !== PORTABLE_PHASE_MESSAGE_SCHEMA_VERSION) {
    throw new Error('unsupported portable phase message schema version')
  }

  if (message.phase === 'scan') {
    exactKeys(
      message,
      [
        'schemaVersion',
        'phase',
        'messageId',
        'network',
        'epochId',
        'baseIdentity',
        'expectedPreviousLedgerIndex',
        'expectedPreviousLedgerHash',
      ],
      'scan phase message',
    )
    const expected = buildScanPhaseMessage({
      network: requiredString(message.network, 'network'),
      epochId: requiredString(message.epochId, 'epochId'),
      baseIdentity: requiredString(message.baseIdentity, 'baseIdentity'),
      expectedPreviousLedgerIndex: requiredNonNegativeInteger(
        message.expectedPreviousLedgerIndex,
        'expectedPreviousLedgerIndex',
      ),
      expectedPreviousLedgerHash: canonicalHash(
        requiredString(message.expectedPreviousLedgerHash, 'expectedPreviousLedgerHash'),
        'expectedPreviousLedgerHash',
      ),
    })
    if (message.messageId !== expected.messageId) {
      throw new Error('scan phase messageId does not match its semantic identity')
    }
    return expected
  }

  if (message.phase === 'commit') {
    exactKeys(
      message,
      ['schemaVersion', 'phase', 'messageId', 'workId', 'chunkIndex'],
      'commit phase message',
    )
    const expected = buildCommitPhaseMessage({
      workId: requiredString(message.workId, 'workId'),
      chunkIndex: requiredNonNegativeInteger(message.chunkIndex, 'chunkIndex'),
    })
    if (message.messageId !== expected.messageId) {
      throw new Error('commit phase messageId does not match its semantic identity')
    }
    return expected
  }

  if (message.phase === 'finalize') {
    exactKeys(
      message,
      ['schemaVersion', 'phase', 'messageId', 'workId'],
      'finalize phase message',
    )
    const expected = buildFinalizePhaseMessage({
      workId: requiredString(message.workId, 'workId'),
    })
    if (message.messageId !== expected.messageId) {
      throw new Error('finalize phase messageId does not match its semantic identity')
    }
    return expected
  }

  throw new Error('portable phase message has an unknown phase')
}
