import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../current-state/canonical-json'
import {
  assertHistoryBackfillPlan,
  buildHistoryBackfillPlan,
  type HistoryBackfillPlan,
} from './backfill-plan'

const PLAN_URL = new URL(
  '../../../docs/evidence/canonical-history-backfill-plan-3371676-3432924.json',
  import.meta.url,
)

describe('canonical history backfill plan', () => {
  it('matches the deterministic planner output byte-for-byte', () => {
    const text = readFileSync(PLAN_URL, 'utf8')
    const plan = JSON.parse(text) as HistoryBackfillPlan

    expect(() => assertHistoryBackfillPlan(plan)).not.toThrow()

    const rebuilt = buildHistoryBackfillPlan({
      epochId: plan.epochId,
      startLedgerIndex: plan.startLedgerIndex,
      endLedgerIndex: plan.endLedgerIndex,
      segmentLedgerLimit: plan.segmentLedgerLimit,
      checkpointEverySegments: plan.checkpointEverySegments,
    })

    expect(`${canonicalJson(rebuilt)}\n`).toBe(text)
    expect(plan.ledgerCount).toBe(61_249)
    expect(plan.segmentCount).toBe(123)
    expect(plan.checkpointCount).toBe(13)
    expect(plan.segments[9]).toMatchObject({
      ordinal: 10,
      startLedgerIndex: 3_376_176,
      endLedgerIndex: 3_376_675,
      checkpointAfter: true,
    })
  })
})
