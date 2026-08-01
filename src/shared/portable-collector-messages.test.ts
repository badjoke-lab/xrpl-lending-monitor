import { describe, expect, it } from 'vitest'

import {
  PORTABLE_PHASE_MESSAGE_MAX_BYTES,
  buildCommitPhaseMessage,
  buildFinalizePhaseMessage,
  buildScanPhaseMessage,
  encodePortablePhaseMessage,
  parsePortablePhaseMessage,
} from './portable-collector-messages'

describe('portable collector phase messages', () => {
  it('builds deterministic scan, commit, and finalize identities', () => {
    const scan = buildScanPhaseMessage({
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      expectedPreviousLedgerIndex: 100,
      expectedPreviousLedgerHash: 'a'.repeat(64),
    })
    expect(scan.messageId).toBe(
      `scan:v1:devnet:epoch-1:base-100:100:${'A'.repeat(64)}`,
    )
    expect(parsePortablePhaseMessage(encodePortablePhaseMessage(scan))).toEqual(scan)

    const commit = buildCommitPhaseMessage({ workId: 'work:101', chunkIndex: 2 })
    expect(commit.messageId).toBe('commit:v1:work%3A101:2')
    expect(parsePortablePhaseMessage(encodePortablePhaseMessage(commit))).toEqual(commit)

    const finalize = buildFinalizePhaseMessage({ workId: 'work:101' })
    expect(finalize.messageId).toBe('finalize:v1:work%3A101')
    expect(parsePortablePhaseMessage(encodePortablePhaseMessage(finalize))).toEqual(finalize)
  })

  it('rejects changed identity, unknown fields, and unknown versions', () => {
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
