/**
 * Read-only, fail-closed GitHub REST owner opt-in resolver for D4 automatic
 * maintenance. Avoid gh api --paginate response concatenation (#39131270295,
 * #39138146597). Use exact owner control messages and verify every page.
 */
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const ENABLE='/d4-auto-enable'
const DISABLE='/d4-auto-disable'

export async function readDbLessD4OwnerApproval({
  repository,owner,token,fetcher=fetch,maxPages=50,
}) {
  if (!REPO.test(repository) || repository.split('/')[0] !== owner
    || typeof token !== 'string' || token.length===0
    || !Number.isSafeInteger(maxPages) || maxPages<1 || maxPages>50) {
    throw new Error('D4 auto owner approval input is invalid')
  }
  let command=DISABLE
  let latestControlId=null
  let lastId=0
  let complete=false
  let pages=0
  for(let page=1;page<=maxPages;page++){
    const url=`https://api.github.com/repos/${repository}/issues/1736/comments?per_page=100&page=${page}`
    const response=await fetcher(url,{
      headers:{
        Authorization:`Bearer ${token}`,
        Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',
      },
      redirect:'error',signal:AbortSignal.timeout(15000),
    })
    if(!response.ok) throw new Error(`D4 owner control API returned HTTP ${response.status}`)
    const comments=await response.json()
    if(!Array.isArray(comments) || comments.length>100) {
      throw new Error('D4 owner control page shape invalid')
    }
    pages=page
    for(const entry of comments){
      if(!entry || !Number.isSafeInteger(entry.id) || entry.id<=lastId
        || !entry.user || typeof entry.user.login!=='string'
        || typeof entry.body!=='string') {
        throw new Error('D4 owner control response malformed or unordered')
      }
      lastId=entry.id
      if(entry.user.login===owner && (entry.body===ENABLE || entry.body===DISABLE)){
        command=entry.body
        latestControlId=entry.id
      }
    }
    if(comments.length<100){complete=true;break}
  }
  if(!complete)throw new Error('D4 owner control pagination exceeded bound')
  return {
    schemaVersion:1,enabled:command===ENABLE,command,latestControlId,
    pagesVerified:pages,issueNumber:1736,
  }
}

async function main(){
  if(process.argv.length!==3)throw new Error('usage: node db-less-d4-owner-approval.mjs OUTPUT.json')
  const result=await readDbLessD4OwnerApproval({
    repository:process.env.GITHUB_REPOSITORY,
    owner:process.env.GITHUB_REPOSITORY_OWNER,
    token:process.env.GH_TOKEN,
  })
  await writeFile(process.argv[2],JSON.stringify(result)+'\n','utf8')
  process.stdout.write(`D4 owner approval: enabled=${result.enabled}, pages=${result.pagesVerified}\n`)
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(e=>{
    process.stderr.write(`D4 owner approval verification failed: ${e instanceof Error?e.message:String(e)}\n`)
    process.exitCode=1
  })
}
