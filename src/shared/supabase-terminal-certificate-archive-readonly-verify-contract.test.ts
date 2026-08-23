import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const scriptPath = resolve(
  process.cwd(),
  'scripts/r5-terminal-certificate-archive-readonly-verify.mjs',
)
const contractPath = resolve(
  process.cwd(),
  'ops/production-sql/20260824012500_xrpl_terminal_certificate_archive_atomic_prepare_contract.json',
)

const script = readFileSync(scriptPath, 'utf8')
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))

function extractSqlSource(text: string) {
  const start = text.indexOf('const SQL = String.raw`')
  const end = text.indexOf('`\n\nif (!/^\\s*with', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return text.slice(start + 'const SQL = String.raw`'.length, end)
}

describe('terminal certificate/archive independent read-only verify contract', () => {
  it('uses only a Management API read-only SELECT surface', () => {
    const sql = extractSqlSource(script)
    expect(sql.trimStart().toLowerCase().startsWith('with ')).toBe(true)
    expect(sql).not.toMatch(
      /\b(insert|update|delete|truncate|vacuum|alter|drop|create|reindex|cluster|grant|revoke)\b/iu,
    )
    expect(script).toContain('/database/query')
    expect(script).toContain('read_only: true')
    expect(script).not.toContain('supabase db push')
    expect(script).not.toContain('wrangler deploy')
  })

  it('binds every expected-after function and unchanged identity helper', () => {
    for (const key of Object.keys(contract.expectedAfter.functionDefinitionSha256)) {
      expect(script).toContain(`'${key}'`)
    }
    for (const key of Object.keys(contract.expectedAfter.identityHelperDefinitionSha256Unchanged)) {
      expect(script).toContain(`'${key}'`)
    }
    expect(script).toContain("['duplicateCompletion', 'xrpl_phase_archive_v1.duplicate_completion(text,text)']")
    expect(script).toContain('sha256(row.definition) === expected')
    expect(script).toContain('sha256(duplicate.source) === expected.sourceSha256')
  })

  it('requires the exact certificate column shapes and durable historical mapping', () => {
    expect(script).toContain("'public.xrpl_phase_work'::regclass")
    expect(script).toContain("a.attname='source_scan_sequence'")
    expect(script).toContain("'public.xrpl_phase_streams'::regclass")
    expect(script).toContain("a.attname='next_scan_sequence'")
    expect(script).toContain("format_type(a.atttypid,a.atttypmod) as data_type")
    expect(script).toContain("pg_get_constraintdef(c.oid,true)")
    expect(script).toContain("string_agg(work_id||':'||source_scan_sequence::text")
    expect(script).toContain('state.mappingDigest === prestate.productiveMappingDigest')
    expect(script).toContain('state.committedWorkCount === prestate.productiveScanRows')
    expect(contract.productionEvidence.prestate.productiveMappingDigest).toBe(
      '53a1c842b41c20efe5c24ab5b858be9a56a7a0b62f9f7029bd300bad00b90cd8',
    )
  })

  it('keeps duplicate-completion security and identity boundaries explicit', () => {
    expect(script).toContain("duplicate.owner === expected.owner")
    expect(script).toContain("duplicate.securityDefiner === expected.securityDefiner")
    expect(script).toContain("duplicate.serviceRoleExecute === expected.serviceRoleDirectExecute")
    expect(script).toContain("settings.includes(`search_path=${expected.searchPath}`)")
    expect(contract.expectedAfter.duplicateCompletion).toEqual({
      sourceSha256: '5ca60025c49a205de120c352ecef9d48ac18db566515b6595fe93909958098b4',
      owner: 'postgres',
      securityDefiner: true,
      serviceRoleDirectExecute: false,
      searchPath: 'public, xrpl_phase_archive_v1, extensions, pg_temp',
    })
  })

  it('requires zero duplicate transport IDs and zero active scan/stream sequences before rearm', () => {
    expect(script).toContain(
      'state.transportDuplicateMessageIds === prestate.transportDuplicateMessageIds',
    )
    expect(script).toContain(
      'JSON.stringify(state.activeScanSequences) === JSON.stringify(prestate.activeScanSequences)',
    )
    expect(script).toContain('state.activeStreamSequences.every((value) => value === 0)')
    expect(contract.productionEvidence.prestate.transportDuplicateMessageIds).toBe(0)
    expect(contract.productionEvidence.prestate.activeScanSequences).toEqual([0])
  })

  it('cannot self-authorize production mutation or R5/Mainnet runtime changes', () => {
    expect(contract.independentReadOnlyVerify.required).toBe(true)
    expect(contract.independentReadOnlyVerify.mustUseReadOnlyDatabaseAccess).toBe(true)
    expect(contract.independentReadOnlyVerify.r5RearmIsSeparateAuthorization).toBe(true)
    expect(script).toContain('productionMutationAuthorized: false')
    expect(script).toContain('schedulerMutationAuthorized: false')
    expect(script).toContain('publicReaderMutationAuthorized: false')
    expect(script).toContain('archiveDeletionAuthorized: false')
    expect(script).toContain('r5RearmAuthorized: false')
    expect(script).toContain('mainnetEnabled: false')
    expect(script).not.toContain('productionMutationAuthorized: true')
    expect(script).not.toContain('r5RearmAuthorized: true')
    expect(script).not.toContain('mainnetEnabled: true')
  })
})
