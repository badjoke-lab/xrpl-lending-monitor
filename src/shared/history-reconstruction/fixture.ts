interface FixtureEvent { ledgerIndex: number; transactionHash: string }
interface FixtureChange extends FixtureEvent { objectId: string }
interface FixtureSegment {
  id: number
  startLedgerIndex: number
  endLedgerIndex: number
  startParentHash: string
  endLedgerHash: string
  semantics: {
    protocolEvents: FixtureEvent[]
    objectChanges: FixtureChange[]
    loanLifecycle: { ledgerIndex: number; transactionHash: string; loanId: string }[]
    archivedObjects: { deletionLedgerIndex: number; objectId: string }[]
    balanceHistory: { ledgerIndex: number; subjectId: string }[]
  }
}

interface ReconstructionFixture {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  fixedWitness: { ledgerIndex: number; transactionHash: string; objectId: string }
  segments: FixtureSegment[]
}

export const HISTORY_RECONSTRUCTION_FIXTURE: ReconstructionFixture = {
  schemaVersion: 1,
  network: 'devnet',
  epochId: 'fixture-history-reconstruction-v1',
  fixedWitness: {
    ledgerIndex: 1_009,
    transactionHash: 'FIXTURE-TX-1009',
    objectId: 'FIXTURE-VAULT-1009',
  },
  segments: [
    {
      id: 0, startLedgerIndex: 1_001, endLedgerIndex: 1_004,
      startParentHash: '0'.repeat(64), endLedgerHash: '1'.repeat(64),
      semantics: {
        protocolEvents: [{ ledgerIndex: 1_001, transactionHash: 'FIXTURE-TX-1001' }],
        objectChanges: [{ ledgerIndex: 1_001, transactionHash: 'FIXTURE-TX-1001', objectId: 'FIXTURE-VAULT-1001' }],
        loanLifecycle: [], archivedObjects: [], balanceHistory: [],
      },
    },
    {
      id: 1, startLedgerIndex: 1_005, endLedgerIndex: 1_008,
      startParentHash: '1'.repeat(64), endLedgerHash: '2'.repeat(64),
      semantics: {
        protocolEvents: [],
        objectChanges: [],
        loanLifecycle: [{ ledgerIndex: 1_006, transactionHash: 'FIXTURE-TX-1006', loanId: 'FIXTURE-LOAN' }],
        archivedObjects: [], balanceHistory: [],
      },
    },
    {
      id: 2, startLedgerIndex: 1_009, endLedgerIndex: 1_012,
      startParentHash: '2'.repeat(64), endLedgerHash: '3'.repeat(64),
      semantics: {
        protocolEvents: [{ ledgerIndex: 1_009, transactionHash: 'FIXTURE-TX-1009' }],
        objectChanges: [{ ledgerIndex: 1_009, transactionHash: 'FIXTURE-TX-1009', objectId: 'FIXTURE-VAULT-1009' }],
        loanLifecycle: [],
        archivedObjects: [{ deletionLedgerIndex: 1_010, objectId: 'FIXTURE-LOAN-DELETED' }],
        balanceHistory: [],
      },
    },
    {
      id: 3, startLedgerIndex: 1_013, endLedgerIndex: 1_016,
      startParentHash: '3'.repeat(64), endLedgerHash: '4'.repeat(64),
      semantics: {
        protocolEvents: [], objectChanges: [], loanLifecycle: [], archivedObjects: [],
        balanceHistory: [{ ledgerIndex: 1_015, subjectId: 'FIXTURE-VAULT-1009' }],
      },
    },
  ],
}

export function assertFixtureContinuity(fixture: {
  segments: readonly {
    id: number
    startLedgerIndex: number
    endLedgerIndex: number
    startParentHash: string
    endLedgerHash: string
  }[]
} = HISTORY_RECONSTRUCTION_FIXTURE): void {
  for (let index = 1; index < fixture.segments.length; index += 1) {
    const previous = fixture.segments[index - 1]!
    const current = fixture.segments[index]!
    if (current.startLedgerIndex !== previous.endLedgerIndex + 1 || current.startParentHash !== previous.endLedgerHash) {
      throw new Error(`Fixture parent-hash discontinuity before segment ${current.id}`)
    }
  }
}

export function findFixtureWitness(fixture = HISTORY_RECONSTRUCTION_FIXTURE): {
  transactionFound: boolean
  objectChangeFound: boolean
} {
  const events = fixture.segments.flatMap((segment) => segment.semantics.protocolEvents)
  const changes = fixture.segments.flatMap((segment) => segment.semantics.objectChanges)
  return {
    transactionFound: events.some((event) => event.ledgerIndex === fixture.fixedWitness.ledgerIndex && event.transactionHash === fixture.fixedWitness.transactionHash),
    objectChangeFound: changes.some((change) => change.ledgerIndex === fixture.fixedWitness.ledgerIndex && change.transactionHash === fixture.fixedWitness.transactionHash && change.objectId === fixture.fixedWitness.objectId),
  }
}
