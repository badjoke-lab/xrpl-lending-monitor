export type DurableTerminalPhase = 'scan' | 'commit' | 'finalize'

export type DurablePhaseWork = {
  workId: string
  profileId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  startLedgerIndex: number
  expectedParentHash: string
  scannedEndLedgerIndex: number
  finalLedgerHash: string
  status: string
  payloadDigest: string
  expectedPayloadChunks: number
  expectedCommitChunks: number
  sourceScanSequence: number
  createdAt: string
  committedAt: string | null
}

export type DurableDuplicateCompletion = {
  source: 'durable_work'
  phase: DurableTerminalPhase
  messageId: string
  payload: Record<string, unknown>
  successorMessageId: string
  completedAt: string | null
  completedAtProven: boolean
  resultDigestProven: false
  completion: {
    completed: true
    duplicate: true
    derived: true
    successor_message_id: string
    completed_at: string | null
  }
}

export type ArchiveFirstDuplicateCompletion =
  | {
      source: 'archive'
      completion: Readonly<Record<string, unknown>>
      derived: null
    }
  | {
      source: 'durable_work'
      completion: DurableDuplicateCompletion['completion']
      derived: DurableDuplicateCompletion
    }

const DURABLE_SCAN_WORK_STATUSES = new Set([
  'planned',
  'staged',
  'committing',
  'finalizing',
  'committed',
  'error',
])

function requireSafeNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
}

function canonicalHash(value: string, name: string): string {
  const upper = value.toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(upper)) {
    throw new Error(`${name} must be a canonical 64-character hash`)
  }
  return upper
}

function encodedIdentityPart(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return encodeURIComponent(normalized)
}

function canonicalWorkId(work: DurablePhaseWork): string {
  return [
    'collector-work-v1',
    encodedIdentityPart(work.network, 'network'),
    encodedIdentityPart(work.epochId, 'epochId'),
    encodedIdentityPart(work.baseIdentity, 'baseIdentity'),
    String(work.startLedgerIndex),
    encodeURIComponent(canonicalHash(work.expectedParentHash, 'expectedParentHash')),
  ].join(':')
}

function escapedWorkId(workId: string): string {
  return workId.replaceAll(':', '%3A')
}

function validateDurableWork(work: DurablePhaseWork): void {
  requireSafeNonNegativeInteger(work.previousLedgerIndex, 'previousLedgerIndex')
  requireSafeNonNegativeInteger(work.startLedgerIndex, 'startLedgerIndex')
  requireSafeNonNegativeInteger(work.scannedEndLedgerIndex, 'scannedEndLedgerIndex')
  requireSafeNonNegativeInteger(work.expectedPayloadChunks, 'expectedPayloadChunks')
  requireSafeNonNegativeInteger(work.expectedCommitChunks, 'expectedCommitChunks')
  requireSafeNonNegativeInteger(work.sourceScanSequence, 'sourceScanSequence')
  if (work.startLedgerIndex !== work.previousLedgerIndex + 1) {
    throw new Error(`durable work start boundary is invalid: ${work.workId}`)
  }
  if (work.scannedEndLedgerIndex < work.startLedgerIndex) {
    throw new Error(`durable work end boundary is invalid: ${work.workId}`)
  }
  if (work.expectedCommitChunks < 1 || work.expectedPayloadChunks < 1) {
    throw new Error(`durable work chunk counts are invalid: ${work.workId}`)
  }
  if (!/^[a-f0-9]{64}$/u.test(work.payloadDigest)) {
    throw new Error(`durable work payload digest is invalid: ${work.workId}`)
  }
  canonicalHash(work.expectedParentHash, 'expectedParentHash')
  canonicalHash(work.finalLedgerHash, 'finalLedgerHash')
  if (work.workId !== canonicalWorkId(work)) {
    throw new Error(`durable work identity is non-canonical: ${work.workId}`)
  }
  if (work.status === 'committed' && work.committedAt === null) {
    throw new Error(`committed durable work has no committedAt: ${work.workId}`)
  }
}

function scanMessageId(work: DurablePhaseWork): string {
  return [
    'scan',
    'v1',
    encodedIdentityPart(work.network, 'network'),
    encodedIdentityPart(work.epochId, 'epochId'),
    encodedIdentityPart(work.baseIdentity, 'baseIdentity'),
    String(work.previousLedgerIndex),
    encodeURIComponent(canonicalHash(work.expectedParentHash, 'expectedParentHash')),
    String(work.sourceScanSequence),
  ].join(':')
}

function scanPayload(work: DurablePhaseWork, messageId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    phase: 'scan',
    messageId,
    network: work.network,
    epochId: work.epochId,
    baseIdentity: work.baseIdentity,
    expectedPreviousLedgerIndex: work.previousLedgerIndex,
    expectedPreviousLedgerHash: canonicalHash(work.expectedParentHash, 'expectedParentHash'),
    scanSequence: work.sourceScanSequence,
  }
}

function commitMessageId(work: DurablePhaseWork, chunkIndex: number): string {
  return `commit:v1:${escapedWorkId(work.workId)}:${chunkIndex}`
}

function finalizeMessageId(work: DurablePhaseWork): string {
  return `finalize:v1:${escapedWorkId(work.workId)}`
}

function successorScanMessageId(work: DurablePhaseWork): string {
  return [
    'scan',
    'v1',
    encodedIdentityPart(work.network, 'network'),
    encodedIdentityPart(work.epochId, 'epochId'),
    encodedIdentityPart(work.baseIdentity, 'baseIdentity'),
    String(work.scannedEndLedgerIndex),
    encodeURIComponent(canonicalHash(work.finalLedgerHash, 'finalLedgerHash')),
    '0',
  ].join(':')
}

function buildDerived(
  phase: DurableTerminalPhase,
  messageId: string,
  payload: Record<string, unknown>,
  successorMessageId: string,
  completedAt: string | null,
  completedAtProven: boolean,
): DurableDuplicateCompletion {
  return {
    source: 'durable_work',
    phase,
    messageId,
    payload,
    successorMessageId,
    completedAt,
    completedAtProven,
    resultDigestProven: false,
    completion: {
      completed: true,
      duplicate: true,
      derived: true,
      successor_message_id: successorMessageId,
      completed_at: completedAt,
    },
  }
}

export function resolveDurableDuplicateCompletion(options: {
  messageId: string
  phase: DurableTerminalPhase
  works: readonly DurablePhaseWork[]
}): DurableDuplicateCompletion | null {
  const matches: DurableDuplicateCompletion[] = []

  for (const work of options.works) {
    if (options.phase === 'scan') {
      if (!DURABLE_SCAN_WORK_STATUSES.has(work.status)) continue
      validateDurableWork(work)
      const durableScanMessageId = scanMessageId(work)
      if (options.messageId !== durableScanMessageId) continue
      matches.push(buildDerived(
        'scan',
        options.messageId,
        scanPayload(work, durableScanMessageId),
        commitMessageId(work, 0),
        work.createdAt,
        true,
      ))
      continue
    }

    if (work.status !== 'committed') continue
    validateDurableWork(work)

    if (options.phase === 'commit') {
      for (let chunkIndex = 0; chunkIndex < work.expectedCommitChunks; chunkIndex += 1) {
        if (options.messageId !== commitMessageId(work, chunkIndex)) continue
        const successor = chunkIndex + 1 < work.expectedCommitChunks
          ? commitMessageId(work, chunkIndex + 1)
          : finalizeMessageId(work)
        matches.push(buildDerived(
          'commit',
          options.messageId,
          {
            schemaVersion: 1,
            phase: 'commit',
            messageId: options.messageId,
            workId: work.workId,
            chunkIndex,
          },
          successor,
          null,
          false,
        ))
      }
      continue
    }

    if (options.messageId === finalizeMessageId(work)) {
      matches.push(buildDerived(
        'finalize',
        options.messageId,
        {
          schemaVersion: 1,
          phase: 'finalize',
          messageId: options.messageId,
          workId: work.workId,
        },
        successorScanMessageId(work),
        work.committedAt,
        true,
      ))
    }
  }

  if (matches.length > 1) {
    throw new Error(`durable duplicate completion identity is ambiguous: ${options.messageId}`)
  }
  return matches[0] ?? null
}

export function resolveArchiveFirstDuplicateCompletion(options: {
  archiveResult: Readonly<Record<string, unknown>> | null
  messageId: string
  phase: DurableTerminalPhase
  works: readonly DurablePhaseWork[]
}): ArchiveFirstDuplicateCompletion | null {
  if (options.archiveResult !== null) {
    return { source: 'archive', completion: options.archiveResult, derived: null }
  }

  const derived = resolveDurableDuplicateCompletion({
    messageId: options.messageId,
    phase: options.phase,
    works: options.works,
  })
  if (derived === null) return null
  return { source: 'durable_work', completion: derived.completion, derived }
}
