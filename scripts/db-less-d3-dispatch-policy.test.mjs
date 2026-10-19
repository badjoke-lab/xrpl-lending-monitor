import assert from 'node:assert/strict'
import test from 'node:test'
import {assessD3DispatchGate as assess} from './db-less-d3-dispatch-policy.mjs'

const NOW=Date.parse('2026-10-19T17:00:00Z')
const run=(status,minutesOld)=>({
  status,createdAt:new Date(NOW-minutesOld*60_000).toISOString(),
})

test('active live worker always blocks even when older than its timeout',()=>{
  const r=assess([run('in_progress',55)],{nowMs:NOW})
  assert.equal(r.canDispatch,false)
  assert.equal(r.blockers,1)
})
test('fresh pending and queued starts preserve single-writer safety',()=>{
  const r=assess([run('queued',3),run('pending',11)],{nowMs:NOW})
  assert.equal(r.canDispatch,false)
  assert.equal(r.blockers,2)
})
test('orphan queued after GitHub dispatch 500 no longer blocks all later slots',()=>{
  const r=assess([run('queued',205)],{nowMs:NOW})
  assert.equal(r.canDispatch,true)
  assert.equal(r.staleQueued,1)
  assert.equal(r.blockers,0)
})
test('a valid worker still blocks when orphan is present',()=>{
  const r=assess([run('queued',205),run('in_progress',1)],{nowMs:NOW})
  assert.equal(r.canDispatch,false)
  assert.equal(r.staleQueued,1)
  assert.equal(r.blockers,1)
})
test('waiting for approval never silently becomes stale-ignorable',()=>{
  for(const status of ['waiting','requested']){
    assert.equal(assess([run(status,240)],{nowMs:NOW}).canDispatch,false)
  }
})
test('invalid/malformed API input fails closed',()=>{
  assert.throws(()=>assess({status:'queued'},{nowMs:NOW}),/invalid/)
  assert.throws(()=>assess([{status:'queued'}],{nowMs:NOW}),/identity/)
  assert.throws(()=>assess([{status:'queued',createdAt:'oops'}],{nowMs:NOW}),/time/)
  assert.throws(()=>assess([run('pending',-10)],{nowMs:NOW}),/time/)
})
test('done runs do not block collector, fresh queued still does',()=>{
  const r=assess([run('completed',1),run('queued',2)],{nowMs:NOW})
  assert.equal(r.canDispatch,false)
  assert.equal(r.blockers,1)
})
