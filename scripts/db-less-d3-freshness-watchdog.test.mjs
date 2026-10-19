import assert from 'node:assert/strict'
import test from 'node:test'
import {assessD3FreshnessWatchdog as decide} from './db-less-d3-freshness-watchdog.mjs'

const NOW=Date.parse('2026-10-20T00:00:00Z')
const channel=(minutesOld=4)=>({
  schemaVersion:1,network:'devnet',
  channelSha256:'a'.repeat(64),lastCommittedLedgerIndex:6247063,
  updatedAt:new Date(NOW-minutesOld*60_000).toISOString(),
})
const runs=(status,minutesOld)=>[{status,createdAt:new Date(NOW-minutesOld*60_000).toISOString()}]
const check=(c,r=[])=>decide({channel:c,runs:r,nowMs:NOW})
test('fresh publication causes no unnecessary recovery dispatch',()=>{
  const x=check(channel(4))
  assert.equal(x.sourceStale,false)
  assert.equal(x.shouldDispatch,false)
})
test('stale publication with no worker starts one bounded recovery',()=>{
  const x=check(channel(200),[])
  assert.equal(x.shouldDispatch,true)
  assert.equal(x.ageSeconds,12000)
  assert.equal(x.channelMutation,false)
})
test('orphan queued does not block recovery after GitHub dispatch 500',()=>{
  const x=check(channel(200),runs('queued',200))
  assert.equal(x.shouldDispatch,true)
  assert.equal(x.staleQueued,1)
})
test('never starts over a legitimate running or fresh queued writer',()=>{
  for(const status of ['in_progress','waiting','requested']){
    assert.equal(check(channel(200),runs(status,200)).shouldDispatch,false)
  }
  assert.equal(check(channel(200),runs('queued',2)).shouldDispatch,false)
  assert.equal(check(channel(200),runs('pending',2)).shouldDispatch,false)
})
test('reject malformed source, invalid clock and corrupted run list',()=>{
  assert.throws(()=>check({...channel(),channelSha256:'fake'}),/metadata/)
  assert.throws(()=>check({...channel(),updatedAt:'invalid'}),/timestamp/)
  assert.throws(()=>check(channel(),[{}]),/identity/)
})
