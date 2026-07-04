import { describe, expect, it } from 'vitest'
import { evaluateCatchUpRehearsal } from './catch-up-rehearsal'

describe('catch-up rehearsal', () => {
  it('passes a contiguous interruption and resume sequence', () => {
    const report = evaluateCatchUpRehearsal({
      baseLedger: 100,
      validatedHead: 105,
      checkpoints: [
        { phase: 'commit', rangeStart: 101, rangeEnd: 102, cursorLedger: 102, cursorHash: 'H102', overlayLedger: 102, overlayHash: 'H102' },
        { phase: 'interrupt', rangeStart: null, rangeEnd: null, cursorLedger: 102, cursorHash: 'H102', overlayLedger: 102, overlayHash: 'H102' },
        { phase: 'resume', rangeStart: 103, rangeEnd: 105, cursorLedger: 105, cursorHash: 'H105', overlayLedger: 105, overlayHash: 'H105' },
        { phase: 'replay', rangeStart: 103, rangeEnd: 105, cursorLedger: 105, cursorHash: 'H105', overlayLedger: 105, overlayHash: 'H105' },
        { phase: 'gap_rejected', rangeStart: 107, rangeEnd: 107, cursorLedger: 105, cursorHash: 'H105', overlayLedger: 105, overlayHash: 'H105' },
      ],
      baseCounts: { vaults: 10, loanBrokers: 20, loans: 30 },
      countDeltas: {
        created: { vaults: 1, loanBrokers: 2, loans: 3 },
        deletedFromBase: { vaults: 0, loanBrokers: 1, loans: 1 },
      },
      resolvedCounts: { vaults: 11, loanBrokers: 21, loans: 32 },
      relationshipIssues: [],
      deletedObjectIds: ['D1'],
      currentObjectIds: ['A1'],
      archivedObjectIds: ['D1'],
    })

    expect(report.passed).toBe(true)
    expect(report.issues).toEqual([])
    expect(report.finalCursorLedger).toBe(105)
  })
})
