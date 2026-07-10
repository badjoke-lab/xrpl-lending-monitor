import { describe, expect, it } from 'vitest'

import type { HistoryExtensionPlan } from './extension-plan'
import { assertHistoryExtensionArtifacts } from './extension-artifacts'
import {
  HISTORY_SEGMENT_FILE_KINDS,
  type HistorySegmentManifest,
} from './manifest'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)
const E = 'E'.repeat(64)

function plan(): HistoryExtensionPlan {
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-99',
    source: {
      chainId: 'canonical-devnet-100-109',
      publicationSha256: 'a'.repeat(64),
      startLedgerIndex: 100,
      endLedgerIndex: 109,
      endLedgerHash: A,
      segmentCount: 1,
      ledgerCount: 10,
      lastSegmentId: 'devnet-99-100-109',
    },
    target: { ledgerIndex: 113, ledgerHash: D },
    extension: {
      startLedgerIndex: 110,
      endLedgerIndex: 113,
      ledgerCount: 4,
      segmentLedgerLimit: 2,
      checkpointEverySegments: 1,
      segmentCount: 2,
      checkpointCount: 2,
      anchorPreviousSegmentId: 'devnet-99-100-109',
      anchorPreviousSegmentEndHash: A,
      segments: [
        {
          ordinal: 1,
          segmentId: 'devnet-99-110-111',
          startLedgerIndex: 110,
          endLedgerIndex: 111,
          ledgerCount: 2,
          checkpointAfter: true,
        },
        {
          ordinal: 2,
          segmentId: 'devnet-99-112-113',
          startLedgerIndex: 112,
          endLedgerIndex: 113,
          ledgerCount: 2,
          checkpointAfter: true,
        },
      ],
    },
  }
}

function files(ledgerCount: number): HistorySegmentManifest['files'] {
  return HISTORY_SEGMENT_FILE_KINDS.map((kind) => ({
    kind,
    path: `${kind}.ndjson.gz`,
    bytes: 0,
    records: kind === 'ledgers' ? ledgerCount : 0,
    sha256: '0'.repeat(64),
  }))
}

function manifests(): HistorySegmentManifest[] {
  return [
    {
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'devnet-99',
      segmentId: 'devnet-99-110-111',
      startLedgerIndex: 110,
      startLedgerHash: B,
      startParentHash: A,
      endLedgerIndex: 111,
      endLedgerHash: C,
      ledgerCount: 2,
      sourceRevision: 'test',
      generatedAt: '2026-07-10T00:00:00.000Z',
      previousSegmentId: 'devnet-99-100-109',
      previousSegmentEndHash: A,
      files: files(2),
    },
    {
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'devnet-99',
      segmentId: 'devnet-99-112-113',
      startLedgerIndex: 112,
      startLedgerHash: E,
      startParentHash: C,
      endLedgerIndex: 113,
      endLedgerHash: D,
      ledgerCount: 2,
      sourceRevision: 'test',
      generatedAt: '2026-07-10T00:00:01.000Z',
      previousSegmentId: 'devnet-99-110-111',
      previousSegmentEndHash: C,
      files: files(2),
    },
  ]
}

describe('history extension artifacts', () => {
  it('accepts manifests that exactly realize the frozen plan', () => {
    expect(assertHistoryExtensionArtifacts({ plan: plan(), manifests: manifests() })).toEqual({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'devnet-99',
      sourceTerminal: {
        ledgerIndex: 109,
        ledgerHash: A,
        segmentId: 'devnet-99-100-109',
      },
      target: { ledgerIndex: 113, ledgerHash: D },
      extension: {
        startLedgerIndex: 110,
        endLedgerIndex: 113,
        ledgerCount: 4,
        segmentCount: 2,
      },
    })
  })

  it('rejects a manifest from a different planned range', () => {
    const values = manifests()
    values[1] = { ...values[1]!, segmentId: 'devnet-99-999-1000' }
    expect(() => assertHistoryExtensionArtifacts({ plan: plan(), manifests: values }))
      .toThrow('segment ID mismatch')
  })

  it('rejects a broken predecessor chain', () => {
    const values = manifests()
    values[1] = { ...values[1]!, previousSegmentEndHash: E }
    expect(() => assertHistoryExtensionArtifacts({ plan: plan(), manifests: values }))
      .toThrow('predecessor hash mismatch')
  })

  it('rejects a terminal hash that differs from the frozen target', () => {
    const values = manifests()
    values[1] = { ...values[1]!, endLedgerHash: E }
    expect(() => assertHistoryExtensionArtifacts({ plan: plan(), manifests: values }))
      .toThrow('History segment chain terminal ledger hash mismatch')
  })
})
