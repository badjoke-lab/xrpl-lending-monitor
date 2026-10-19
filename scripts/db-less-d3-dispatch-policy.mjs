/**
 * Non-mutating D3 schedule gate.
 * An indefinitely "queued" dispatch without a job must not suppress
 * every subsequent collector forever after GitHub dispatch HTTP 500.
 * In-progress and waiting-for-approval runs ALWAYS block a new writer.
 */
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

export function assessD3DispatchGate(runs,{nowMs,staleQueueAfterMs=12*60*1000}={}){
  if(!Array.isArray(runs) || !Number.isFinite(nowMs) || nowMs<0
    || !Number.isSafeInteger(staleQueueAfterMs) || staleQueueAfterMs<60_000){
    throw new Error('D3 dispatch gate input invalid')
  }
  let blockers=0, staleQueued=0
  for(const run of runs){
    if(!run || typeof run.status!=='string' || typeof run.createdAt!=='string'){
      throw new Error('D3 dispatch run identity invalid')
    }
    const created=Date.parse(run.createdAt)
    if(!Number.isFinite(created) || created>nowMs+60_000) {
      throw new Error('D3 dispatch run time invalid')
    }
    if(['in_progress','waiting','requested'].includes(run.status)){
      blockers++
      continue
    }
    if(['queued','pending'].includes(run.status)){
      if(nowMs-created>=staleQueueAfterMs)staleQueued++
      else blockers++
    }
  }
  return {schemaVersion:1,canDispatch:blockers===0,blockers,staleQueued}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw new Error('usage: node db-less-d3-dispatch-policy.mjs runs.json')
    const runs=JSON.parse(readFileSync(process.argv[2],'utf8'))
    const result=assessD3DispatchGate(runs,{nowMs:Date.now()})
    process.stdout.write(JSON.stringify(result)+'\n')
  }catch(e){
    process.stderr.write('D3 dispatch gate failed closed: '+(e instanceof Error?e.message:String(e))+'\n')
    process.exitCode=1
  }
}
