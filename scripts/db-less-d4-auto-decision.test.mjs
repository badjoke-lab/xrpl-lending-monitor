import assert from 'node:assert/strict'
import test from 'node:test'
import { decideDbLessD4AutoUpdate as decide } from './db-less-d4-auto-decision.mjs'

const NOW=Date.parse('2026-10-18T00:00:00Z')
const H='A'.repeat(64), K='B'.repeat(64), S='c'.repeat(64)
const make=(head=1100,seed=1000)=>({
  d3:{schemaVersion:1,network:'devnet',epochId:'ep',base:{generationId:'base'},
    channelSha256:S,lastCommittedLedgerIndex:head,lastCommittedLedgerHash:H,
    updatedAt:new Date(NOW-80_000).toISOString(),
    currentProjectionTail:{coverageStartLedgerIndex:950,coverageStartLedgerHash:K,
      generations:Array.from({length:90},(_,i)=>({
        startLedgerIndex:951+i,endLedgerIndex:951+i,
      }))}},
  d4:{schemaVersion:1,network:'devnet',epochId:'ep',
    channelSha256:S,updatedAt:new Date(NOW-7_200_000).toISOString(),
    active:{baseIdentity:'base',throughLedgerIndex:seed,throughLedgerHash:H}},
  nowMs:NOW,
})

test('no update when fresh checkpoint has less than 36 new mutation generations',()=>{
  const x=make(1100,1040)
  assert.equal(decide(x).decision,'SKIP')
  assert.equal(decide(x).shouldBuild,false)
  assert.equal(decide(x).newIndexedGenerations,0)
})
test('update after 6h even if indexed mutations were sparse',()=>{
  const x=make(1100,1040)
  x.d4.updatedAt=new Date(NOW-22_000_000).toISOString()
  assert.equal(decide(x).decision,'MAINTENANCE_DUE')
})
test('unattended update fires before eviction and escalates urgency',()=>{
  const due=decide(make(1100,998))
  assert.equal(due.decision,'MAINTENANCE_DUE')
  assert.equal(due.newIndexedGenerations,42)
  const urgentInput=make(1100,950)
  urgentInput.d4.active.throughLedgerHash=K
  const urgent=decide(urgentInput)
  assert.equal(urgent.decision,'URGENT')
  assert.equal(urgent.indexedHeadroomGenerations,38)
})
test('out of index triggers verified historical chain recovery, not a data-loss assumption',()=>{
  const x=decide(make(1100,900))
  assert.equal(x.decision,'EMERGENCY_REPLAY')
  assert.equal(x.historicalChainStillNeedsVerification,true)
  assert.equal(x.indexCoverageOk,false)
  assert.equal(x.shouldBuild,true)
})
test('stale D3 blocks publication regardless of urgency',()=>{
  const x=make(1100,900)
  x.d3.updatedAt=new Date(NOW-1_000_000).toISOString()
  const y=decide(x)
  assert.equal(y.decision,'SOURCE_STALE')
  assert.equal(y.shouldBuild,false)
})
test('already aligned checkpoint does not publish',()=>{
  const x=make(1100,1100)
  assert.equal(decide(x).decision,'UP_TO_DATE')
  assert.equal(decide(x).shouldBuild,false)
})
test('epoch, base, index overlap, digest, future time and reversed head are rejected',()=>{
  const ep=make();ep.d3.epochId='wrong'
  assert.throws(()=>decide(ep),/epoch/)
  const overlap=make();overlap.d3.currentProjectionTail.generations[1].startLedgerIndex=950
  assert.throws(()=>decide(overlap),/overlap/)
  const hash=make();hash.d3.channelSha256='invalid'
  assert.throws(()=>decide(hash),/digest/)
  const clock=make();clock.d4.updatedAt=new Date(NOW+120_000).toISOString()
  assert.throws(()=>decide(clock),/clock/)
  const order=make();order.d3.lastCommittedLedgerIndex=500
  assert.throws(()=>decide(order),/head\/index shape/)
})
test('checkpoint at indexed boundary must match the full ledger hash',()=>{
  const x=make(1100,950)
  assert.throws(()=>decide(x),/boundary hash/)
  x.d4.active.throughLedgerHash=K
  assert.equal(decide(x).decision,'URGENT')
})
