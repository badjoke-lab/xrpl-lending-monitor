import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const [entryArg, outputArg, evidenceArg] = process.argv.slice(2)
if (!entryArg || !outputArg) {
  throw new Error('usage: bun build-r5-production-edge-bundle.ts <entry> <output> [evidence]')
}

const entry = resolve(entryArg)
const output = resolve(outputArg)
const evidence = evidenceArg ? resolve(evidenceArg) : null
const bunVersion = Bun.version
if (bunVersion !== '1.3.14') {
  throw new Error(`production R5 Edge bundle requires Bun 1.3.14, got ${bunVersion}`)
}

const REVISION4_SELECTION_DIGEST =
  '99a1f97fc17ed6023bc3075bffe963a260e99a4ed0e2d831b068826c7797222f'
const REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES = 0
const selectionEnvName = 'XRPL_R5_REVISION4_SELECTION_DIGEST'
const reserveEnvName = 'XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES'
const isRecoveryEntry = entryArg.replaceAll('\\', '/').endsWith(
  'supabase/functions/xrpl-r5-recovery-batch/index.ts',
)

let buildEntry = entry
let fixedConfigBound = false
let temporaryEntry: string | null = null
if (isRecoveryEntry) {
  const source = await readFile(entry, 'utf8')
  const selectionBlock = `function selectionDigest(): string {\n  const value = env('${selectionEnvName}')\n  if (!/^[a-f0-9]{64}$/u.test(value)) {\n    throw new RecoveryError('${selectionEnvName} is invalid', true)\n  }\n  return value\n}`
  const selectionReplacement = `function selectionDigest(): string {\n  const value = '${REVISION4_SELECTION_DIGEST}'\n  if (!/^[a-f0-9]{64}$/u.test(value)) {\n    throw new RecoveryError('revision-4 fixed selection digest is invalid', true)\n  }\n  return value\n}`
  const reserveBlock = `function unexplainedDirectionalReserveBytes(): number {\n  const raw = env('${reserveEnvName}')\n  const value = Number(raw)\n  if (!Number.isSafeInteger(value) || value < 0) {\n    throw new RecoveryError(\n      '${reserveEnvName} is invalid',\n      true,\n    )\n  }\n  return value\n}`
  const reserveReplacement = `function unexplainedDirectionalReserveBytes(): number {\n  const value = ${REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES}\n  if (!Number.isSafeInteger(value) || value < 0) {\n    throw new RecoveryError('revision-4 fixed unexplained egress reserve is invalid', true)\n  }\n  return value\n}`

  if (source.split(selectionBlock).length !== 2) {
    throw new Error('production R5 source selection-digest binding drifted')
  }
  if (source.split(reserveBlock).length !== 2) {
    throw new Error('production R5 source unexplained-reserve binding drifted')
  }
  const transformed = source
    .replace(selectionBlock, selectionReplacement)
    .replace(reserveBlock, reserveReplacement)
  if (transformed.includes(selectionEnvName) || transformed.includes(reserveEnvName)) {
    throw new Error('production R5 fixed configuration still depends on legacy environment names')
  }
  temporaryEntry = resolve(dirname(entry), `.production-r5-entry-${process.pid}.ts`)
  await writeFile(temporaryEntry, transformed)
  buildEntry = temporaryEntry
  fixedConfigBound = true
}

let result
try {
  result = await Bun.build({
    entrypoints: [buildEntry],
    target: 'browser',
    format: 'esm',
  })
} finally {
  if (temporaryEntry) await rm(temporaryEntry, { force: true })
}
if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log)
  throw new Error(`production R5 Edge build failed with ${result.outputs.length} outputs`)
}

const bytes = Buffer.from(await result.outputs[0].arrayBuffer())
const bundle = bytes.toString('utf8')
const unresolvedRelativeImport = /(?:from\s*|import\s*\()\s*['"]\.{1,2}\//u
if (unresolvedRelativeImport.test(bundle)) {
  throw new Error('production R5 Edge bundle retains a relative import')
}
if (bundle.includes('cloudflare:')) {
  throw new Error('production R5 Edge bundle contains a Cloudflare runtime import')
}
if (!bundle.includes('Deno.serve')) {
  throw new Error('production R5 Edge bundle does not contain a Deno.serve entrypoint')
}
if (bundle.includes('__XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__')) {
  throw new Error('production R5 Edge bundle contains qualification-only override code')
}
if (isRecoveryEntry) {
  if (!fixedConfigBound) throw new Error('production R5 fixed config was not bound')
  if (bundle.includes(selectionEnvName) || bundle.includes(reserveEnvName)) {
    throw new Error('production R5 Edge bundle retains a legacy fixed-config environment dependency')
  }
  if (!bundle.includes(REVISION4_SELECTION_DIGEST)) {
    throw new Error('production R5 Edge bundle is missing the fixed revision-4 selection digest')
  }
}

await writeFile(output, bytes)
const bundleEvidence = {
  schemaVersion: 2,
  purpose: 'production-r5-edge-prebundle',
  entry: entryArg,
  bunVersion,
  bytes: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  relativeImports: 0,
  cloudflareImports: 0,
  qualificationOverrides: 0,
  denoServeEntrypoint: true,
  fixedRevision4ConfigBound: isRecoveryEntry ? fixedConfigBound : null,
  legacyFixedConfigEnvironmentDependencies: isRecoveryEntry ? 0 : null,
  revision4SelectionDigest: isRecoveryEntry ? REVISION4_SELECTION_DIGEST : null,
  revision4UnexplainedEgressReserveBytes:
    isRecoveryEntry ? REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES : null,
}
if (evidence) {
  await writeFile(evidence, `${JSON.stringify(bundleEvidence, null, 2)}\n`)
}
console.log(JSON.stringify(bundleEvidence))
