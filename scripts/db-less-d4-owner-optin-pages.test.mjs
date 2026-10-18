import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

// gh api --paginate --slurp returns a JSON ARRAY OF PAGES; do not feed
// concatenated, unseparated page arrays to jq -s (production #39131270295).
const FILTER = `[.[][] | select(.user.login == $owner) |
  (.body // "") | select(. == "/d4-auto-enable" or . == "/d4-auto-disable")] |
  last // "/d4-auto-disable"`
const item = (login, body) => ({user:{login},body})
function evaluate(pages){
  return execFileSync('jq',['-r','--arg','owner','badjoke-lab',FILTER],{
    input:JSON.stringify(pages),encoding:'utf8'
  }).trim()
}
test('no owner opt-in fails closed',()=>{
  assert.equal(evaluate([[]]),'/d4-auto-disable')
  assert.equal(evaluate([[item('attacker','/d4-auto-enable')]]),'/d4-auto-disable')
})
test('owner exact enable is recognized with slurped API array',()=>{
  assert.equal(evaluate([[item('badjoke-lab','/d4-auto-enable')]]),'/d4-auto-enable')
})
test('most recent owner command across multiple pages wins',()=>{
  assert.equal(evaluate([
    [item('badjoke-lab','/d4-auto-enable'),item('attacker','/d4-auto-disable')],
    [item('badjoke-lab','/d4-auto-disable')]
  ]),'/d4-auto-disable')
  assert.equal(evaluate([
    [item('badjoke-lab','/d4-auto-disable')],
    [item('badjoke-lab','/d4-auto-enable')]
  ]),'/d4-auto-enable')
})
test('ignore non-exact command and comments by others',()=>{
  assert.equal(evaluate([[
    item('badjoke-lab','/d4-auto-enable\\nother text'),
    item('attacker','/d4-auto-enable')
  ]]),'/d4-auto-disable')
})
