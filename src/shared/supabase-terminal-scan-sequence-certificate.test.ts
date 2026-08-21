import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildScanPhaseMessage } from './portable-collector-messages'
import { buildPortableCollectorWorkId } from './portable-collector-planner'
import type { DurablePhaseWork } from './supabase-terminal-archive-durable-fallback'
import {
  createActiveScanSequenceCertificate,
  PROPOSED_SCAN_SEQUENCE_CERTIFICATE_STORAGE,
  recordCaughtUpScanCompletion,
  recordProductiveScanCompletion,
  resetActiveCertificateAfterFinalize,
  resolveCertifiedScanDuplicate,
  type ScanBoundaryIdentity,
} from './supabase-terminal-scan-sequence-certificate'

const messageContract = readFileSync(
  resolve(process.cwd(), 'src/shared/portable-collector-messages.ts'),
  'utf8',
)
const r5Completion = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260803123100_xrpl_r5_recovery_batch_complete.sql'),
  'utf8',
)

function boundary(overrides: Partial<ScanBoundaryIdentity> = {}): ScanBoundaryIdentity {
  return {
    profileId: overrides.profileId ?? 'supabase-devnet',
    network: overrides.network ?? 'devnet',
    epochId: overrides.epochId ?? 'supabase-r4c2c-v1',
    baseIdentity: overrides.baseIdentity ?? 'durable-proof-base',
    previousLedgerIndex: overrides.previousLedgerIndex ?? 4_200_000,
    previousLedgerHash: overrides.previousLedgerHash ?? 'A'.repeat(64),
  }
}

function work(
  source: ScanBoundaryIdentity,
  overrides: Partial<DurablePhaseWork> = {},
): DurablePhaseWork {
  const identity = {
    network: source.network,
    epochId: source.epochId,
    baseIdentity: source.baseIdentity,
    previousLedgerIndex: source.previousLedgerIndex,
    expectedParentHash: source.previousLedgerHash,
  }
  return {
    workId: overrides.workId ?? buildPortableCollectorWorkId(identity),
    profileId: source.profileId,
    network: source.network,
    epochId: source.epochId,
    baseIdentity: source.baseIdentity,
    previousLedgerIndex: source.previousLedgerIndex,
    startLedgerIndex: source.previousLedgerIndex + 1,
    expectedParentHash: source.previousLedgerHash,
    scannedEndLedgerIndex: overrides.scannedEndLedgerIndex ?? source.previousLedgerIndex + 1,
    finalLedgerHash: overrides.finalLedgerHash ?? 'B'.repeat(64),
    status: overrides.status ?? 'committed',
    payloadDigest: overrides.payloadDigest ?? 'c'.repeat(64),
    expectedPayloadChunks: overrides.expectedPayloadChunks ?? 2,
    expectedCommitChunks: overrides.expectedCommitChunks ?? 2,
    createdAt: overrides.createdAt ?? '2026-08-21T00:01:00.000Z',
    committedAt: overrides.committedAt === undefined
      ? '2026-08-21T00:01:02.000Z'
      : overrides.committedAt,
  }
}

function scanId(source: ScanBoundaryIdentity, sequence: number): string {
  return buildScanPhaseMessage({
    network: source.network,
    epochId: source.epochId,
    baseIdentity: source.baseIdentity,
    expectedPreviousLedgerIndex: source.previousLedgerIndex,
    expectedPreviousLedgerHash: source.previousLedgerHash,
    scanSequence: sequence,
  }).messageId
}

describe('bounded terminal scan-sequence certificate proof', () => {
  it('uses one mutable active sequence to certify arbitrarily many caught-up completions', () => {
    const source = boundary()
    let active = createActiveScanSequenceCertificate(source)

    expect(active.nextScanSequence).toBe(0)
    expect(resolveCertifiedScanDuplicate({
      messageId: scanId(source, 0),
      productiveCertificates: [],
      activeCertificate: active,
    })).toBeNull()

    for (let sequence = 0; sequence < 25; sequence += 1) {
      active = recordCaughtUpScanCompletion({
        certificate: active,
        messageId: scanId(source, sequence),
      })
    }

    expect(active.nextScanSequence).toBe(25)
    for (const sequence of [0, 1, 12, 24]) {
      const duplicate = resolveCertifiedScanDuplicate({
        messageId: scanId(source, sequence),
        productiveCertificates: [],
        activeCertificate: active,
      })
      expect(duplicate?.outcome).toBe('caught_up')
      expect(duplicate?.scanSequence).toBe(sequence)
      expect(duplicate?.successorMessageId).toBe(scanId(source, sequence + 1))
      expect(duplicate?.completedAt).toBeNull()
      expect(duplicate?.completedAtProven).toBe(false)
      expect(duplicate?.resultDigestProven).toBe(false)
    }

    expect(resolveCertifiedScanDuplicate({
      messageId: scanId(source, 25),
      productiveCertificates: [],
      activeCertificate: active,
    })).toBeNull()
  })

  it('collapses a completed caught-up chain plus productive scan into one integer on the work', () => {
    const source = boundary()
    let active = createActiveScanSequenceCertificate(source)
    for (let sequence = 0; sequence < 7; sequence += 1) {
      active = recordCaughtUpScanCompletion({
        certificate: active,
        messageId: scanId(source, sequence),
      })
    }

    const committedWork = work(source)
    const productive = recordProductiveScanCompletion({
      certificate: active,
      messageId: scanId(source, 7),
      work: committedWork,
    })
    expect(productive.sourceScanSequence).toBe(7)

    for (let sequence = 0; sequence < 7; sequence += 1) {
      const duplicate = resolveCertifiedScanDuplicate({
        messageId: scanId(source, sequence),
        productiveCertificates: [productive],
        activeCertificate: null,
      })
      expect(duplicate?.outcome).toBe('caught_up')
      expect(duplicate?.successorMessageId).toBe(scanId(source, sequence + 1))
    }

    const staged = resolveCertifiedScanDuplicate({
      messageId: scanId(source, 7),
      productiveCertificates: [productive],
      activeCertificate: null,
    })
    expect(staged?.outcome).toBe('staged')
    expect(staged?.completedAt).toBe(committedWork.createdAt)
    expect(staged?.completedAtProven).toBe(true)
    expect(staged?.successorMessageId).toContain('commit:v1:')
    expect(resolveCertifiedScanDuplicate({
      messageId: scanId(source, 8),
      productiveCertificates: [productive],
      activeCertificate: null,
    })).toBeNull()
  })

  it('resets only the current mutable sequence when finalize advances the boundary', () => {
    const source = boundary()
    let active = createActiveScanSequenceCertificate(source)
    active = recordCaughtUpScanCompletion({
      certificate: active,
      messageId: scanId(source, 0),
    })
    const committedWork = work(source)
    const productive = recordProductiveScanCompletion({
      certificate: active,
      messageId: scanId(source, 1),
      work: committedWork,
    })

    const next = resetActiveCertificateAfterFinalize(productive)
    expect(next.previousLedgerIndex).toBe(committedWork.scannedEndLedgerIndex)
    expect(next.previousLedgerHash).toBe(committedWork.finalLedgerHash)
    expect(next.nextScanSequence).toBe(0)

    expect(resolveCertifiedScanDuplicate({
      messageId: scanId(source, 1),
      productiveCertificates: [productive],
      activeCertificate: next,
    })?.outcome).toBe('staged')
  })

  it('fails closed on skipped sequence, wrong boundary, noncanonical work, and ambiguity', () => {
    const source = boundary()
    const active = createActiveScanSequenceCertificate(source)

    expect(() => recordCaughtUpScanCompletion({
      certificate: active,
      messageId: scanId(source, 1),
    })).toThrow('certified next sequence')

    expect(() => recordProductiveScanCompletion({
      certificate: active,
      messageId: scanId(source, 0),
      work: work(boundary({ previousLedgerIndex: source.previousLedgerIndex + 10 })),
    })).toThrow('certified scan boundary')

    expect(() => recordProductiveScanCompletion({
      certificate: active,
      messageId: scanId(source, 0),
      work: work(source, { workId: 'non-canonical-work' }),
    })).toThrow('work identity is non-canonical')

    const productive = recordProductiveScanCompletion({
      certificate: active,
      messageId: scanId(source, 0),
      work: work(source),
    })
    expect(() => resolveCertifiedScanDuplicate({
      messageId: scanId(source, 0),
      productiveCertificates: [productive, productive],
      activeCertificate: null,
    })).toThrow('identity is ambiguous')
  })

  it('uses canonical shared message builders for lookup and successor identity', () => {
    const source = boundary({
      epochId: 'epoch with spaces',
      baseIdentity: 'base:value/with?reserved#characters',
    })
    let active = createActiveScanSequenceCertificate(source)
    const canonicalZero = buildScanPhaseMessage({
      network: source.network,
      epochId: source.epochId,
      baseIdentity: source.baseIdentity,
      expectedPreviousLedgerIndex: source.previousLedgerIndex,
      expectedPreviousLedgerHash: source.previousLedgerHash,
      scanSequence: 0,
    }).messageId

    active = recordCaughtUpScanCompletion({ certificate: active, messageId: canonicalZero })
    const duplicate = resolveCertifiedScanDuplicate({
      messageId: canonicalZero,
      productiveCertificates: [],
      activeCertificate: active,
    })
    expect(duplicate?.successorMessageId).toBe(scanId(source, 1))
  })

  it('keeps the proposed certificate bounded instead of appending one row per scan', () => {
    expect(PROPOSED_SCAN_SEQUENCE_CERTIFICATE_STORAGE).toEqual({
      productiveSequenceField: 'xrpl_phase_work.source_scan_sequence',
      activeSequenceField: 'xrpl_phase_streams.next_scan_sequence',
      appendOnlyScanCertificateRowsRequired: false,
    })
  })

  it('matches the existing scan identity semantics and R5 sequence-zero path', () => {
    for (const required of [
      'scanSequence: number',
      "String(scanSequence)",
      "scanSequence: requiredNonNegativeInteger(message.scanSequence, 'scanSequence')",
    ]) {
      expect(messageContract).toContain(required)
    }

    expect(r5Completion).toContain(
      'v_last_index, v_last_hash, 0',
    )
    expect(r5Completion).toContain(
      "'expectedPreviousLedgerHash', v_final_hash,\n        'scanSequence', 0",
    )
    expect(r5Completion).toContain(
      "and status = 'pending'\n      and attempt_count = 0",
    )
  })
})
