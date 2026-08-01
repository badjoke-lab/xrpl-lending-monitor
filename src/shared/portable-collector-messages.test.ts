import { describe, expect, it } from 'vitest'

import {
  PORTABLE_PHASE_MESSAGE_MAX_BYTES,
  buildCommitPhaseMessage,
  buildFinalizePhaseMessage,
  buildScanPhaseMessage,
  encodePortablePhaseMessage,
  parsePortablePhaseMessage,
} from './portable-collector-messages'

const scanInput = {
  network: 'devnet',
  epochId: 'epoch-1',
  baseIdentity: 'base-100',
  expectedPreviousLedgerIndex: 100,
  expectedPreviousLedgerHash: 'a'.repeat(64),
}

describe('portable collector phase messages', () => {
  it('builds deterministic scan, commit, and finalize identities', () => {
    const scan = buildScanPhaseMessage({ ...scanInput, scanSequence: 0 })
    expect(scan.messageId).toBe(
      `scan:v1:devnet:epoch-1:base-100:100:${'A'.repeat(64)}:0`,
    )
    expect(scan.scanSequence).toBe(0)
    expect(parsePortablePhaseMessage(encodePortablePhaseMessage(scan))).toEqual(scan)

    const commit = buildCommitPhaseMessage({ workId: 'work:101', chunkIndex: 2 })
    expect(commit.messageId).toBe('commit:v1:work%3A101:2')
    expect(parsePortablePhaseMessage(encodePortablePhaseMessage(commit))).toEqual(commit)

    const finalize = buildFinalizePhaseMessage({ workId: 'work:101' })
    expect(finalize.messageId).toBe('finalize:v1:work%3A101')
    expect(parsePortablePhaseMessage(encodePortablePhaseMessage(finalize))).toEqual(finalize)
  })

  it('distinguishes repeated caught-up wake-ups without changing the boundary', () => {
    const initial = buildScanPhaseMessage({ ...scanInput, scanSequence: 0 })
    const repeated = buildScanPhaseMessage({ ...scanInput, scanSequence: 1 })

    expect(repeated).toMatchObject({
      network: initial.network,
      epochId: initial.epochId,
      baseIdentity: initial.baseIdentity,
      expectedPreviousLedgerIndex: initial.expectedPreviousLedgerIndex,
      expectedPreviousLedgerHash: initial.expectedPreviousLedgerHash,
      scanSequence: 1,
    })
    expect(repeated.messageId).not.toBe(initial.messageId)
    expect(repeated.messageId.endsWith(':1')).toBe(true)
  })

  it('rejects changed identity, invalid sequence, unknown fields, and unknown versions', () => {
    const scan = buildScanPhaseMessage({ ...scanInput, scanSequence: 0 })
    expect(() =>
      parsePortablePhaseMessage(JSON.stringify({ ...scan, messageId: `${scan.messageId}-changed` })),
    ).toThrow('messageId does not match')

    for (const scanSequence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        buildScanPhaseMessage({ ...scanInput, scanSequence }),
      ).toThrow('scanSequence must be a non-negative safe integer')
    }
    const { scanSequence: _omitted, ...withoutSequence } = scan
    expect(() => parsePortablePhaseMessage(JSON.stringify(withoutSequence))).toThrow(
      'unexpected or missing fields',
    )

    const commit = buildCommitPhaseMessage({ workId: 'work-1', chunkIndex: 0 })
    expect(() =>
      parsePortablePhaseMessage(
        JSON.stringify({ ...commit, messageId: 'commit:v1:work-1:1' }),
      ),
    ).toThrow('messageId does not match')

    expect(() =>
      parsePortablePhaseMessage(JSON.stringify({ ...commit, extra: true })),
    ).toThrow('unexpected or missing fields')

    expect(() =>
      parsePortablePhaseMessage(JSON.stringify({ ...commit, schemaVersion: 2 })),
    ).toThrow('unsupported portable phase message schema version')
  })

  it('enforces the canonical scheduler message byte guard', () => {
    const oversized = buildFinalizePhaseMessage({
      workId: 'x'.repeat(PORTABLE_PHASE_MESSAGE_MAX_BYTES),
    })
    expect(() => encodePortablePhaseMessage(oversized)).toThrow(
      `exceeds ${PORTABLE_PHASE_MESSAGE_MAX_BYTES} bytes`,
    )
    expect(() => parsePortablePhaseMessage(' '.repeat(PORTABLE_PHASE_MESSAGE_MAX_BYTES + 1))).toThrow(
      `exceeds ${PORTABLE_PHASE_MESSAGE_MAX_BYTES} bytes`,
    )
  })
})
