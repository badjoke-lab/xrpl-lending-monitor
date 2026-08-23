import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const script = readFileSync(
  resolve(process.cwd(), 'scripts/r5-transport-target-source-readonly-audit.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-index-footprint-readonly-probe.yml'),
  'utf8',
)
const sqlStartMarker = 'const SQL=`'
const sqlStart = script.indexOf(sqlStartMarker)
const sqlEnd = script.indexOf('`\nif (!/', sqlStart)
if (sqlStart < 0 || sqlEnd < 0) throw new Error('target source SQL template not found')
const sqlTemplate = script.slice(sqlStart + sqlStartMarker.length, sqlEnd)

describe('archive duplicate completion source read-only audit', () => {
  it('targets the private archive function by schema, name, and identity arguments', () => {
    expect(script).toContain("['archive_duplicate_fallback_required','xrpl_phase_archive_v1','duplicate_completion']")
    expect(script).toContain("row.schemaName==='xrpl_phase_archive_v1'")
    expect(script).toContain("row.functionName==='duplicate_completion'")
    expect(script).toContain('archive duplicate_completion overload count must be 1')
    expect(script).toContain("duplicateTargets[0].identityArguments!=='p_message_id text, p_phase text'")
    expect(script).toContain('archive duplicate_completion identity arguments drifted')
  })

  it('keeps the production query SELECT-only and Management API read-only', () => {
    expect(script).toContain("if (!/^\\s*select\\b/iu.test(SQL)) fail('target source audit must be SELECT only')")
    expect(script).toContain('body:JSON.stringify({query:sql,read_only:true})')
    expect(sqlTemplate.trimStart().toLowerCase().startsWith('select ')).toBe(true)
    expect(sqlTemplate).not.toMatch(/\b(insert|update|delete|alter|drop|truncate|vacuum|reindex)\b/iu)
  })

  it('captures exact definition and source fingerprints in sanitized evidence', () => {
    expect(script).toContain("definitionSha256:createHash('sha256').update(String(row.definition),'utf8').digest('hex')")
    expect(script).toContain("sourceSha256:createHash('sha256').update(String(row.source),'utf8').digest('hex')")
    expect(script).toContain("'Archive duplicate fallback exact definition fingerprint:'")
    expect(script).toContain('row.identityArguments')
  })

  it('reuses the exact owner-only Issue #1261 read-only workflow', () => {
    expect(workflow).toContain("github.event.issue.number == 1261")
    expect(workflow).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(workflow).toContain("github.event.comment.body == '/r5-index-footprint-readonly-probe'")
    expect(workflow).toContain('node scripts/r5-transport-target-source-readonly-audit.mjs')
    expect(workflow).not.toContain('workflow_dispatch:')
    expect(workflow).not.toContain('schedule:')
  })
})
