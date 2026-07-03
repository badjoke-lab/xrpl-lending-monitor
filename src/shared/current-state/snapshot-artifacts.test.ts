import { describe, expect, it } from 'vitest'

import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { canonicalJson } from './canonical-json'
import { InMemoryArtifactStore } from './in-memory-artifact-store'
import { buildPageSnapshotArtifacts } from './snapshot-artifacts'

function ledgerObject(
  type: 'Vault' | 'LoanBroker' | 'Loan',
  index: string,
): ScannedLedgerObject {
  return {
    LedgerEntryType: type,
    index,
    BinaryHex: 'ABCD',
    Flags: 0,
  }
}

const identity = {
  network: 'devnet' as const,
  epochId: 'epoch-1',
  snapshotId: 'snapshot-1',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
}

async function buildFixture() {
  return buildPageSnapshotArtifacts({
    identity,
    pageSequence: 7,
    vaults: [
      ledgerObject('Vault', 'C'),
      ledgerObject('Vault', 'A'),
      ledgerObject('Vault', 'B'),
    ],
    loanBrokers: [ledgerObject('LoanBroker', 'D')],
    loans: [ledgerObject('Loan', 'E')],
    maxObjectsPerShard: 2,
    maxUncompressedBytes: 20_000,
  })
}

describe('snapshot artifacts', () => {
  it('canonicalizes object keys', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })
})
