import { describe, expect, it } from 'vitest'
import { evaluateCatchUpRehearsal } from './catch-up-rehearsal'

describe('catch-up rehearsal failure evidence', () => {
  it('reports cursor and count divergence', () => {
    const report = evaluateCatchUpRehearsal({
      baseLedger: 100,
      validatedHead: 105,
      checkpoints: [
        {
          phase: 'commit',
          rangeStart: 102,
          rangeEnd: 103,
          cursorLedger: 103,
          cursorHash: 'H103',
          overlayLedger: 102,
          overlayHash: 'H102',
        },
      ],
      baseCounts: { vaults: 10, loanBrokers: 20, loans: 30 },
      countDeltas: {
        created: { vaults: 1, loanBrokers: 0, loans: 0 },
        deletedFromBase: { vaults: 0, loanBrokers: 0, loans: 0 },
      },
      resolvedCounts: { vaults: 10, loanBrokers: 20, loans: 30 },
      relationshipIssues: [],
      deletedObjectIds: [],
      currentObjectIds: [],
      archivedObjectIds: [],
    })

    expect(report.passed).toBe(false)
    expect(report.issues).toContain('cursor_overlay_divergence:commit:103')
    expect(report.issues).toContain('non_contiguous_start:commit:102')
    expect(report.issues).toContain('count_reconciliation_failed')
  })
})
