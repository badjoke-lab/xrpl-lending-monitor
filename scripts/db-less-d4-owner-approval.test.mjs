import assert from 'node:assert/strict'
import test from 'node:test'
import { readDbLessD4OwnerApproval as read } from './db-less-d4-owner-approval.mjs'

const repository='badjoke-lab/xrpl-lending-monitor'
const note=(id,login,body)=>({id,user:{login},body})
const filler=(start,length)=>Array.from({length},(_,i)=>note(start+i,'other','no-op'))
function fetchPages(pages,code=200){
  let called=0
  const mock=async(url,init)=>{
    assert.match(url,/^https:\/\/api\.github\.com\/repos\/badjoke-lab\/xrpl-lending-monitor\/issues\/1736\/comments\?per_page=100&page=\d+$/)
    assert.equal(init.headers.Authorization,'Bearer test-token')
    const page=Number(new URL(url).searchParams.get('page'))
    called++
    return new Response(JSON.stringify(pages[page-1]??[]),{status:code})
  }
  return {mock,calls:()=>called}
}
const call=(fetcher,more={})=>read({
  repository,owner:'badjoke-lab',token:'test-token',fetcher,...more
})

test('read a verified exact owner enable',async()=>{
  const f=fetchPages([[note(10,'badjoke-lab','/d4-auto-enable')]])
  const r=await call(f.mock)
  assert.equal(r.enabled,true)
  assert.equal(r.latestControlId,10)
  assert.equal(r.pagesVerified,1)
})
test('default disabled and reject third-party enable',async()=>{
  assert.equal((await call(fetchPages([[]]).mock)).enabled,false)
  assert.equal((await call(fetchPages([[note(1,'attacker','/d4-auto-enable')]]).mock)).enabled,false)
})
test('owner revoke always wins across pages',async()=>{
  const pages=[
    [note(1,'badjoke-lab','/d4-auto-enable'),...filler(2,99)],
    [note(101,'badjoke-lab','/d4-auto-disable')],
  ]
  const result=await call(fetchPages(pages).mock)
  assert.equal(result.enabled,false)
  assert.equal(result.latestControlId,101)
  assert.equal(result.pagesVerified,2)
})
test('later exact reenable wins; non-exact commands are ignored',async()=>{
  const data=[[
    note(1,'badjoke-lab','/d4-auto-disable'),
    note(2,'badjoke-lab','/d4-auto-enable extra'),
    note(3,'badjoke-lab','/d4-auto-enable'),
  ]]
  assert.equal((await call(fetchPages(data).mock)).enabled,true)
})
test('reject malformed/unsorted REST comments and API failure',async()=>{
  await assert.rejects(call(fetchPages([[note(2,'badjoke-lab','x'),note(1,'badjoke-lab','/d4-auto-enable')]]).mock),/unordered/)
  await assert.rejects(call(fetchPages([[{bad:'shape'}]]).mock),/malformed/)
  await assert.rejects(call(fetchPages([[]],503).mock),/HTTP 503/)
})
test('reject incomplete pagination and invalid repository',async()=>{
  await assert.rejects(call(fetchPages([filler(1,100)]).mock,{maxPages:1}),/pagination exceeded/)
  await assert.rejects(read({repository:'other/example',owner:'badjoke-lab',token:'test-token',fetcher:fetchPages([[]]).mock}),/input is invalid/)
})
