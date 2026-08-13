import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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

const result = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  format: 'esm',
})
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

await writeFile(output, bytes)
const bundleEvidence = {
  schemaVersion: 1,
  purpose: 'production-r5-edge-prebundle',
  entry: entryArg,
  bunVersion,
  bytes: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  relativeImports: 0,
  cloudflareImports: 0,
  qualificationOverrides: 0,
  denoServeEntrypoint: true,
}
if (evidence) {
  await writeFile(evidence, `${JSON.stringify(bundleEvidence, null, 2)}\n`)
}
console.log(JSON.stringify(bundleEvidence))
