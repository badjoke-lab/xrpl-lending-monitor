/**
 * D3 failover dispatch decision — independent of the 30-minute self-chain.
 * Read-only; never publishes Current or sends a transaction.
 */
import {readFileSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {assessD3DispatchGate} from './db-less-d3-dispatch-policy.mjs'

const SHA=/^[a-f0-9]{64}$/
export function assessD3FreshnessWatchdog({channel,runs,nowMs,maxAgeMs=15*60*1000}){
  if(channel?.schemaVersion!==1 || channel.network!=='devnet'
    || !SHA.test(channel.channelSha256)
    || !Number.isSafeInteger(channel.lastCommittedLedgerIndex)
    || channel.lastCommittedLedgerIndex<1 || typeof channel.updatedAt!=='string'
    || !Number.isSafeInteger(maxAgeMs) || maxAgeMs<60_000){
    throw new Error('D3 watchdog channel metadata is invalid')
  }
  const updated=Date.parse(channel.updatedAt)
  if(!Number.isFinite(updated)||updated>nowMs+60_000){
    throw new Error('D3 watchdog channel publication timestamp invalid')
  }
  const gate=assessD3DispatchGate(runs,{nowMs})
  const ageMs=nowMs-updated
  const stale=ageMs>maxAgeMs
  return {
    schemaVersion:1,sourceStale:stale,ageSeconds:Math.max(0,Math.floor(ageMs/1000)),
    latestLedger:channel.lastCommittedLedgerIndex,
    staleQueued:gate.staleQueued,blockers:gate.blockers,
    shouldDispatch:stale && gate.canDispatch,
    channelMutation:false,
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==5)throw new Error('usage: node db-less-d3-freshness-watchdog.mjs channel.json runs.json output.json')
    const channel=JSON.parse(readFileSync(process.argv[2],'utf8'))
    const runs=JSON.parse(readFileSync(process.argv[3],'utf8'))
    const result=assessD3FreshnessWatchdog({channel,runs,nowMs:Date.now()})
    writeFileSync(process.argv[4],JSON.stringify(result)+'\n','utf8')
    process.stdout.write(JSON.stringify(result)+'\n')
  }catch(e){
    process.stderr.write('D3 watchdog fails closed: '+(e instanceof Error?e.message:String(e))+'\n')
    process.exitCode=1
  }
}
