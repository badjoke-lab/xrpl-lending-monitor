import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = process.cwd()
const PROOF_ENTRY = resolve(
  REPOSITORY_ROOT,
  'supabase/functions/xrpl-r4f-revision4-proof-batch/index.ts',
)
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

function localSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\bimport\s*['"]([^'"]+)['"]/gu,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier?.startsWith('.')) specifiers.push(specifier)
    }
  }
  return [...new Set(specifiers)]
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier)
  const candidates = extname(specifier)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, resolve(base, 'index.ts')]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function inspectProofModuleGraph(): { extensionless: string[]; unresolved: string[] } {
  const pending = [PROOF_ENTRY]
  const visited = new Set<string>()
  const extensionless = new Set<string>()
  const unresolved = new Set<string>()

  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)

    const source = readFileSync(file, 'utf8')
    for (const specifier of localSpecifiers(source)) {
      const display = `${relative(REPOSITORY_ROOT, file)} -> ${specifier}`
      if (!extname(specifier)) extensionless.add(display)

      const target = resolveLocalModule(file, specifier)
      if (!target) {
        unresolved.add(display)
        continue
      }
      if (SOURCE_EXTENSIONS.has(extname(target))) pending.push(target)
    }
  }

  return {
    extensionless: [...extensionless].sort(),
    unresolved: [...unresolved].sort(),
  }
}

describe('revision-4 proof Edge Function module graph', () => {
  it('uses explicit extensions for every local module and resolves the full graph', () => {
    const result = inspectProofModuleGraph()
    expect(result.unresolved).toEqual([])
    expect(result.extensionless).toEqual([])
  })
})
