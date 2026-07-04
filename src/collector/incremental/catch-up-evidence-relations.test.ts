import { describe, expect, it } from 'vitest'
import { evaluateCatchUpRehearsal } from './catch-up-rehearsal'

describe('catch-up relationship evidence', () => {
  it('reports relationship and archive failures', () => {
    const report = evaluateCatchUpRehearsal({
      baseLedger: 100,
      validatedHead: 101,
      checkpoints: [
        { phase: 'commit', rangeStart: 101, rangeEnd: 101, cursorLedger: 101, cursorHash: 'H101', overlayLedger: 101, overlayHash: 'H101' },
      ],
      baseCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
      countDeltas: {
        created: { vaults: 0, loanBrokers: 0, loans: 0 },
        deletedFromBase: { vaults: 0, loanBrokers: 0, loans: 0 },
      },
      resolvedCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
      relationshipIssues: [
        { type: 'loan_missing_broker', objectId: 'L1', relatedId: 'B1' },
      ],
      deletedObjectIds: ['D1'],
      currentObjectIds: ['D1'],
      archivedObjectIds: [],
    })

    expect(report.passed).toBe(false)
    expect(report.issues.some((issue) => issue.startsWith('relationship:'))).toBe(true)
    expect(report.issues).toContain('deleted_object_still_current:D1')
    expect(report.issues).toContain('deleted_object_missing_archive:D1')
  })
})
