import assert from 'node:assert/strict'
import test from 'node:test'
import { assessD4Maintenance } from './db-less-d4-maintenance-policy.mjs'

const nowMs = Date.parse('2026-10-17T14:00:00Z')
const hash = 'A'.repeat(64)
function fixture(checkpoint = 228) {
  return {
    d3: {
      schemaVersion: 1, network: 'devnet', epochId: 'epoch1',
      base: { generationId: 'base1' },
      updatedAt: new Date(nowMs - 100_000).toISOString(),
      lastCommittedLedgerIndex: 228,
      currentProjectionTail: {
        coverageStartLedgerIndex: 100,
        coverageStartLedgerHash: hash,
        generations: Array.from({ length: 128 }, (_, i) => ({
          startLedgerIndex: 101 + i, endLedgerIndex: 101 + i,
        })),
      },
    },
    d4: {
      schemaVersion: 1, network: 'devnet', epochId: 'epoch1',
      active: { baseIdentity: 'base1', throughLedgerIndex: checkpoint,
        throughLedgerHash: hash },
    },
    nowMs,
  }
}
test('healthy with no need for owner involvement', () => {
  const r=assessD4Maintenance(fixture())
  assert.equal(r.status,'HEALTHY')
  assert.equal(r.newIndexedGenerations,0)
  assert.equal(r.remainingIndexHeadroom,128)
  assert.equal(r.channelMutation,false)
})
test('identifies due and urgent *before* the 128-entry index moves past D4', () => {
  const due=assessD4Maintenance(fixture(180))
  assert.equal(due.status,'MAINTENANCE_DUE')
  assert.equal(due.newIndexedGenerations,48)
  assert.equal(due.remainingIndexHeadroom,80)
  const urgent=assessD4Maintenance(fixture(148))
  assert.equal(urgent.status,'URGENT')
  assert.equal(urgent.newIndexedGenerations,80)
  assert.equal(urgent.remainingIndexHeadroom,48)
})
test('distinguishes an indexed coverage gap from proven loss of old Release chain', () => {
  const blocked=assessD4Maintenance(fixture(99))
  assert.equal(blocked.status,'COVERAGE_BLOCKED')
  assert.equal(blocked.uncoveredLedgers,1)
  assert.equal(blocked.coverageOk,false)
})
test('accepts sparse D3 Current mutation generations separated by no-op ledgers',()=>{
  const input=fixture(228)
  for (let i=1;i<input.d3.currentProjectionTail.generations.length;i++){
    const generation=input.d3.currentProjectionTail.generations[i]
    generation.startLedgerIndex+=2
    generation.endLedgerIndex+=2
  }
  input.d3.lastCommittedLedgerIndex=230
  const r=assessD4Maintenance(input)
  assert.equal(r.status,'HEALTHY')
  assert.equal(r.newIndexedGenerations,2)
  assert.equal(r.checkpointLagLedgers,2)
})
test('stale D3 takes precedence over checkpoint pressure', () => {
  const input=fixture(170)
  input.d3.updatedAt=new Date(nowMs-1_200_000).toISOString()
  const r=assessD4Maintenance(input)
  assert.equal(r.status,'SOURCE_STALE')
  assert.equal(r.sourceFresh,false)
})
test('refuses epochs, malformed ordering, checkpoint/hash mismatch and clocks', () => {
  const a=fixture()
  a.d3.epochId='different'
  assert.throws(()=>assessD4Maintenance(a),/epoch/)
  const b=fixture()
  b.d3.currentProjectionTail.generations[1].startLedgerIndex=500
  assert.throws(()=>assessD4Maintenance(b),/overlap/)
  const c=fixture(100)
  c.d4.active.throughLedgerHash='B'.repeat(64)
  assert.throws(()=>assessD4Maintenance(c),/hash/)
  assert.throws(()=>assessD4Maintenance({...fixture(),dueAt:90,urgentAt:90}),/thresholds/)
})
test('handles recent D3 head past last Current mutation without false coverage outage',()=>{
  const a=fixture(228)
  a.d3.lastCommittedLedgerIndex=240
  const r=assessD4Maintenance(a)
  assert.equal(r.status,'HEALTHY')
  assert.equal(r.checkpointLagLedgers,12)
})
