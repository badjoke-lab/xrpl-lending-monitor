import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const generator = resolve(process.cwd(), 'scripts/r5-terminal-certificate-archive-atomic-bundle.mjs')
const expectedPaths = [
  'ops/production-sql/20260823013000_xrpl_terminal_scan_certificate_runtime.sql',
  'ops/production-sql/20260823045000_xrpl_terminal_generic_scan_certificate_runtime.sql',
  'ops/production-sql/20260823051500_xrpl_terminal_archive_scan_durable_fallback.sql',
]
const tempDirs: string[] = []

function generate() {
  const out = mkdtempSync(join(tmpdir(), 'xrpl-terminal-atomic-bundle-'))
  tempDirs.push(out)
  const sourceCommit = 'a'.repeat(40)
  const stdout = execFileSync('node', [
    generator,
    '--source-commit', sourceCommit,
    '--output-dir', out,
  ], { encoding: 'utf8' })
  const sql = readFileSync(join(out, 'terminal-certificate-archive-atomic-bundle.sql'), 'utf8')
  const manifest = JSON.parse(
    readFileSync(join(out, 'terminal-certificate-archive-atomic-manifest.json'), 'utf8'),
  ) as {
    schemaVersion: number
    sourceCommit: string
    orderedStages: Array<{ order: number; path: string; sha256: string }>
    bundleSha256: string
    transactionBoundaryCount: { begin: number; commit: number }
    productionApplied: boolean
    productionMutationAuthorized: boolean
    r5RearmAuthorized: boolean
    mainnetEnabled: boolean
  }
  return { stdout, sql, manifest }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('terminal certificate/archive atomic bundle', () => {
  it('bundles the three reviewed stages in the only allowed order', () => {
    const { sql, manifest } = generate()
    expect(manifest.orderedStages.map((stage) => stage.path)).toEqual(expectedPaths)
    expect(manifest.orderedStages.map((stage) => stage.order)).toEqual([1, 2, 3])
    expect(manifest.orderedStages.every((stage) => /^[a-f0-9]{64}$/u.test(stage.sha256))).toBe(true)

    const positions = expectedPaths.map((path) => sql.indexOf(path))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions[0]).toBeLessThan(positions[1])
    expect(positions[1]).toBeLessThan(positions[2])
  })

  it('has exactly one outer transaction and no standalone inner boundaries', () => {
    const { sql, manifest } = generate()
    expect(sql.match(/^begin;$/gmu)).toHaveLength(1)
    expect(sql.match(/^commit;$/gmu)).toHaveLength(1)
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
    expect(manifest.transactionBoundaryCount).toEqual({ begin: 1, commit: 1 })
  })

  it('retains the dependency sequence from certificate creation through fallback', () => {
    const { sql } = generate()
    const certificate = sql.indexOf('terminal_scan_certificate_columns_already_present_or_partial')
    const generic = sql.indexOf('generic_scan_certificate_requires_terminal_certificate_columns')
    const fallback = sql.indexOf('archive_scan_fallback_requires_terminal_scan_certificate_columns')
    expect(certificate).toBeGreaterThan(-1)
    expect(generic).toBeGreaterThan(certificate)
    expect(fallback).toBeGreaterThan(generic)
  })

  it('emits an auditable manifest but grants no production authority', () => {
    const { stdout, manifest } = generate()
    expect(stdout).toContain('ATOMIC_BUNDLE_MANIFEST=')
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.sourceCommit).toBe('a'.repeat(40))
    expect(manifest.bundleSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(manifest.productionApplied).toBe(false)
    expect(manifest.productionMutationAuthorized).toBe(false)
    expect(manifest.r5RearmAuthorized).toBe(false)
    expect(manifest.mainnetEnabled).toBe(false)
  })

  it('contains no deployment, scheduler, public-reader or automatic apply machinery', () => {
    const generatorText = readFileSync(generator, 'utf8')
    expect(generatorText).not.toMatch(/\b(fetch|curl|wget|psql|supabase|wrangler|gh)\b/iu)
    expect(generatorText).not.toContain('child_process')
    expect(generatorText).not.toContain('xrpl_r5_v1.recovery_runs')
    expect(generatorText).not.toContain('.github/workflows')
  })
})
