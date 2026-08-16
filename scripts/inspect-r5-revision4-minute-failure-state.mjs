#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const outputPath = process.argv[2] ?? 'r5-revision4-minute-completion-repair-evidence/minute-failure-state.json'
const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const runId = 'r5-recovery-selected-revision4-minute-entry'
const formalRunId = 'r5-recovery-selected-revision4-entry'
const qualificationKey = 'r4f-revision4-r5-12-ledger-accounting-v1'

if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID invalid')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN unavailable')

const projectIdentityDigest = createHash('sha256').update(projectRef).digest('hex')
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

function parseJson(text) {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 2000) } }
}
function rows(body) {
  if (Array.isArray(body)) return body
  for (const value of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(value)) return value
  }
  throw new Error('Management API response contains no rows')
}
async function query(sql) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: sql, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) throw new Error(`Management API query failed (${response.status}):${JSON.stringify(body).slice(0, 2000)}`)
  return rows(body)
}

const resultRows = await query(`select jsonb_build_object(
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'minuteRun',(select to_jsonb(r) from xrpl_r5_v1.recovery_runs r where r.run_id='${runId}'),
  'minuteBatches',coalesce((select jsonb_agg(to_jsonb(b) order by b.batch_sequence,b.batch_id) from xrpl_r5_v1.recovery_batches b where b.run_id='${runId}'),'[]'::jsonb),
  'formalRun',(select to_jsonb(r) from xrpl_r5_v1.recovery_runs r where r.run_id='${formalRunId}'),
  'formalEvidence',(select to_jsonb(e) from xrpl_r5_v1.revision4_accounting_qualification_evidence e where e.qualification_key='${qualificationKey}'),
  'canonicalWatermark',(select to_jsonb(w) from public.xrpl_phase_watermarks w where w.profile_id='supabase-devnet'),
  'runtime',(select to_jsonb(r) from public.xrpl_collector_runtime r where r.profile_id='supabase-devnet'),
  'messageCounts',(select jsonb_build_object('pending',count(*) filter(where status='pending'),'leased',count(*) filter(where status='leased'),'retry',count(*) filter(where status='retry')) from public.xrpl_phase_messages where profile_id='supabase-devnet'),
  'inflightWorkCount',(select count(*) from public.xrpl_phase_work where profile_id='supabase-devnet' and status in ('planned','staged','committing','finalizing'))
) state`)
if (resultRows.length !== 1) throw new Error(`state query expected one row, found ${resultRows.length}`)
const state = typeof resultRows[0].state === 'string' ? JSON.parse(resultRows[0].state) : resultRows[0].state
if (!state?.minuteRun || state.minuteRun.run_id !== runId) throw new Error('minute run missing')
if (!state?.formalRun || state.formalRun.run_id !== formalRunId) throw new Error('formal run missing')
if (!state?.formalEvidence || state.formalEvidence.run_id !== formalRunId || state.formalEvidence.qualification_key !== qualificationKey) throw new Error('formal qualification evidence identity mismatch')
if (!Array.isArray(state.minuteBatches)) throw new Error('minute batches shape invalid')

const evidence = {
  schemaVersion: 1,
  purpose: 'r5-revision4-minute-failure-state-read-only',
  projectIdentityDigest,
  maxMigrationVersion: String(state.maxMigrationVersion ?? ''),
  minuteRun: state.minuteRun,
  minuteBatches: state.minuteBatches,
  minuteBatchCount: state.minuteBatches.length,
  formalRun: state.formalRun,
  formalRunDigest: sha256(JSON.stringify(state.formalRun)),
  formalEvidence: state.formalEvidence,
  formalEvidenceDigest: sha256(JSON.stringify(state.formalEvidence)),
  canonicalWatermark: state.canonicalWatermark,
  runtime: state.runtime,
  messageCounts: state.messageCounts,
  inflightWorkCount: Number(state.inflightWorkCount),
  readOnly: true,
  mainnetDisabled: true,
  checkedAt: new Date().toISOString(),
}
const path = resolve(outputPath)
await mkdir(dirname(path), { recursive: true })
await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(evidence))
