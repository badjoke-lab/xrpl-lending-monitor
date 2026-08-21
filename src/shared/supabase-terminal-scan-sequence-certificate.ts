import {
  buildCommitPhaseMessage,
  buildScanPhaseMessage,
} from './portable-collector-messages'
import { buildPortableCollectorWorkId } from './portable-collector-planner'
import type { DurablePhaseWork } from './supabase-terminal-archive-durable-fallback'

export type ScanBoundaryIdentity = {
  profileId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  previousLedgerHash: string
}

export type ActiveScanSequenceCertificate = ScanBoundaryIdentity & {
  kind: 'active_boundary'
  nextScanSequence: number
}

export type ProductiveScanSequenceCertificate = {
  kind: 'productive_work'
  work: DurablePhaseWork
  sourceScanSequence: number
}

export type CertifiedScanDuplicate = {
  source: 'scan_sequence_certificate'
  messageId: string
  scanSequence: number
  outcome: 'caught_up' | 'staged'
  successorMessageId: string
  completedAt: string | null
  completedAtProven: boolean
  resultDigestProven: false
}

export const PROPOSED_SCAN_SEQUENCE_CERTIFICATE_STORAGE = Object.freeze({
  productiveSequenceField: 'xrpl_phase_work.source_scan_sequence',
  activeSequenceField: 'xrpl_phase_streams.next_scan_sequence',
  appendOnlyScanCertificateRowsRequired: false,
})

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
}

function canonicalHash(value: string, name: string): string {
  const hash = value.trim().toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) {
    throw new Error(`${name} must be a canonical 64-character hash`)
  }
  return hash
}

function requiredIdentityPart(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function validateBoundary(boundary: ScanBoundaryIdentity): void {
  if (!boundary.profileId.trim()) throw new Error('profileId is required')
  requiredIdentityPart(boundary.network, 'network')
  requiredIdentityPart(boundary.epochId, 'epochId')
  requiredIdentityPart(boundary.baseIdentity, 'baseIdentity')
  requireNonNegativeInteger(boundary.previousLedgerIndex, 'previousLedgerIndex')
  canonicalHash(boundary.previousLedgerHash, 'previousLedgerHash')
}

function scanMessageId(boundary: ScanBoundaryIdentity, sequence: number): string {
  validateBoundary(boundary)
  requireNonNegativeInteger(sequence, 'scanSequence')
  return buildScanPhaseMessage({
    network: boundary.network,
    epochId: boundary.epochId,
    baseIdentity: boundary.baseIdentity,
    expectedPreviousLedgerIndex: boundary.previousLedgerIndex,
    expectedPreviousLedgerHash: boundary.previousLedgerHash,
    scanSequence: sequence,
  }).messageId
}

function commitMessageId(workId: string, chunkIndex: number): string {
  return buildCommitPhaseMessage({ workId, chunkIndex }).messageId
}

function boundaryFromWork(work: DurablePhaseWork): ScanBoundaryIdentity {
  return {
    profileId: work.profileId,
    network: work.network,
    epochId: work.epochId,
    baseIdentity: work.baseIdentity,
    previousLedgerIndex: work.previousLedgerIndex,
    previousLedgerHash: work.expectedParentHash,
  }
}

function validateProductiveCertificate(certificate: ProductiveScanSequenceCertificate): void {
  const work = certificate.work
  requireNonNegativeInteger(certificate.sourceScanSequence, 'sourceScanSequence')
  requireNonNegativeInteger(work.previousLedgerIndex, 'work.previousLedgerIndex')
  requireNonNegativeInteger(work.startLedgerIndex, 'work.startLedgerIndex')
  requireNonNegativeInteger(work.scannedEndLedgerIndex, 'work.scannedEndLedgerIndex')
  if (work.status !== 'committed') throw new Error(`scan certificate work is not committed: ${work.workId}`)
  if (work.startLedgerIndex !== work.previousLedgerIndex + 1) {
    throw new Error(`scan certificate work start boundary is invalid: ${work.workId}`)
  }
  if (work.expectedCommitChunks < 1) {
    throw new Error(`scan certificate work has no commit successor: ${work.workId}`)
  }
  const expectedWorkId = buildPortableCollectorWorkId({
    network: work.network,
    epochId: work.epochId,
    baseIdentity: work.baseIdentity,
    previousLedgerIndex: work.previousLedgerIndex,
    expectedParentHash: canonicalHash(work.expectedParentHash, 'work.expectedParentHash'),
  })
  if (work.workId !== expectedWorkId) {
    throw new Error(`scan certificate work identity is non-canonical: ${work.workId}`)
  }
  canonicalHash(work.finalLedgerHash, 'work.finalLedgerHash')
  if (work.committedAt === null) {
    throw new Error(`scan certificate committed work has no committedAt: ${work.workId}`)
  }
}

function parseSequenceForBoundary(messageId: string, boundary: ScanBoundaryIdentity): number | null {
  validateBoundary(boundary)
  const marker = ':'
  const split = messageId.lastIndexOf(marker)
  if (split < 0 || split === messageId.length - 1) return null
  const raw = messageId.slice(split + marker.length)
  if (!/^(0|[1-9][0-9]*)$/u.test(raw)) return null
  const sequence = Number(raw)
  if (!Number.isSafeInteger(sequence) || sequence < 0) return null
  if (scanMessageId(boundary, sequence) !== messageId) return null
  return sequence
}

function caughtUpDuplicate(
  boundary: ScanBoundaryIdentity,
  sequence: number,
): CertifiedScanDuplicate {
  return {
    source: 'scan_sequence_certificate',
    messageId: scanMessageId(boundary, sequence),
    scanSequence: sequence,
    outcome: 'caught_up',
    successorMessageId: scanMessageId(boundary, sequence + 1),
    completedAt: null,
    completedAtProven: false,
    resultDigestProven: false,
  }
}

export function createActiveScanSequenceCertificate(
  boundary: ScanBoundaryIdentity,
): ActiveScanSequenceCertificate {
  validateBoundary(boundary)
  return { kind: 'active_boundary', ...boundary, nextScanSequence: 0 }
}

export function recordCaughtUpScanCompletion(options: {
  certificate: ActiveScanSequenceCertificate
  messageId: string
}): ActiveScanSequenceCertificate {
  const certificate = options.certificate
  validateBoundary(certificate)
  requireNonNegativeInteger(certificate.nextScanSequence, 'nextScanSequence')
  const expected = scanMessageId(certificate, certificate.nextScanSequence)
  if (options.messageId !== expected) {
    throw new Error('caught-up scan does not match the certified next sequence')
  }
  return {
    ...certificate,
    nextScanSequence: certificate.nextScanSequence + 1,
  }
}

export function recordProductiveScanCompletion(options: {
  certificate: ActiveScanSequenceCertificate
  messageId: string
  work: DurablePhaseWork
}): ProductiveScanSequenceCertificate {
  const active = options.certificate
  validateBoundary(active)
  requireNonNegativeInteger(active.nextScanSequence, 'nextScanSequence')
  const expectedMessageId = scanMessageId(active, active.nextScanSequence)
  if (options.messageId !== expectedMessageId) {
    throw new Error('productive scan does not match the certified next sequence')
  }

  const workBoundary = boundaryFromWork(options.work)
  validateBoundary(workBoundary)
  if (
    workBoundary.profileId !== active.profileId
    || workBoundary.network !== active.network
    || workBoundary.epochId !== active.epochId
    || workBoundary.baseIdentity !== active.baseIdentity
    || workBoundary.previousLedgerIndex !== active.previousLedgerIndex
    || canonicalHash(workBoundary.previousLedgerHash, 'work previous hash')
      !== canonicalHash(active.previousLedgerHash, 'active previous hash')
  ) {
    throw new Error('productive work does not match the certified scan boundary')
  }

  const productive: ProductiveScanSequenceCertificate = {
    kind: 'productive_work',
    work: options.work,
    sourceScanSequence: active.nextScanSequence,
  }
  validateProductiveCertificate(productive)
  return productive
}

export function resetActiveCertificateAfterFinalize(
  productive: ProductiveScanSequenceCertificate,
): ActiveScanSequenceCertificate {
  validateProductiveCertificate(productive)
  const work = productive.work
  return createActiveScanSequenceCertificate({
    profileId: work.profileId,
    network: work.network,
    epochId: work.epochId,
    baseIdentity: work.baseIdentity,
    previousLedgerIndex: work.scannedEndLedgerIndex,
    previousLedgerHash: work.finalLedgerHash,
  })
}

export function resolveCertifiedScanDuplicate(options: {
  messageId: string
  productiveCertificates: readonly ProductiveScanSequenceCertificate[]
  activeCertificate: ActiveScanSequenceCertificate | null
}): CertifiedScanDuplicate | null {
  const matches: CertifiedScanDuplicate[] = []

  for (const certificate of options.productiveCertificates) {
    validateProductiveCertificate(certificate)
    const boundary = boundaryFromWork(certificate.work)
    const sequence = parseSequenceForBoundary(options.messageId, boundary)
    if (sequence === null || sequence > certificate.sourceScanSequence) continue
    if (sequence < certificate.sourceScanSequence) {
      matches.push(caughtUpDuplicate(boundary, sequence))
      continue
    }
    matches.push({
      source: 'scan_sequence_certificate',
      messageId: options.messageId,
      scanSequence: sequence,
      outcome: 'staged',
      successorMessageId: commitMessageId(certificate.work.workId, 0),
      completedAt: certificate.work.createdAt,
      completedAtProven: true,
      resultDigestProven: false,
    })
  }

  if (options.activeCertificate !== null) {
    const active = options.activeCertificate
    validateBoundary(active)
    requireNonNegativeInteger(active.nextScanSequence, 'nextScanSequence')
    const sequence = parseSequenceForBoundary(options.messageId, active)
    if (sequence !== null && sequence < active.nextScanSequence) {
      matches.push(caughtUpDuplicate(active, sequence))
    }
  }

  if (matches.length > 1) {
    throw new Error(`scan sequence certificate identity is ambiguous: ${options.messageId}`)
  }
  return matches[0] ?? null
}
