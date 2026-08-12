import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type QualificationOnLoadResult = {
  contents: string
  loader: 'ts'
}

type QualificationBuild = {
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<QualificationOnLoadResult>,
  ): void
}

function replaceExactlyOnce(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} must match exactly once`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

const [entryArg, outputArg] = process.argv.slice(2)
if (!entryArg || !outputArg) {
  throw new Error('usage: bun build-r4f-revision4-proof-bundle.ts <entry> <output>')
}
const entry = resolve(entryArg)
const output = resolve(outputArg)

const qualificationTransform = {
  name: 'r4f-revision4-qualification-runtime-override',
  setup(build: QualificationBuild) {
    build.onLoad(
      { filter: /xrpl-r5-recovery-batch\/index\.ts$/u },
      async ({ path }: { path: string }) => {
        let source = await Bun.file(path).text()
        source = replaceExactlyOnce(
          source,
          "type JsonObject = Record<string, unknown>\n",
          `type JsonObject = Record<string, unknown>\ntype Revision4QualificationRuntimeOverride = {\n  selectionDigest: string\n  unexplainedDirectionalReserveBytes: string\n}\ntype Revision4QualificationGlobal = typeof globalThis & {\n  __XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__?: Revision4QualificationRuntimeOverride\n}\n`,
          'qualification override types',
        )
        source = replaceExactlyOnce(
          source,
          `function selectionDigest(): string {\n  const value = env('XRPL_R5_REVISION4_SELECTION_DIGEST')\n  if (!/^[a-f0-9]{64}$/u.test(value)) {\n    throw new RecoveryError('XRPL_R5_REVISION4_SELECTION_DIGEST is invalid', true)\n  }\n  return value\n}\n\nfunction unexplainedDirectionalReserveBytes(): number {\n  const raw = env('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')\n  const value = Number(raw)\n  if (!Number.isSafeInteger(value) || value < 0) {\n    throw new RecoveryError(\n      'XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES is invalid',\n      true,\n    )\n  }\n  return value\n}\n`,
          `function revision4QualificationRuntimeOverride():\n  Revision4QualificationRuntimeOverride | undefined {\n  const value = (globalThis as Revision4QualificationGlobal)\n    .__XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__\n  if (value === undefined) return undefined\n  if (typeof value !== 'object' || value === null) {\n    throw new RecoveryError('revision4 qualification runtime override is invalid', true)\n  }\n  if (\n    typeof value.selectionDigest !== 'string'\n    || typeof value.unexplainedDirectionalReserveBytes !== 'string'\n  ) {\n    throw new RecoveryError('revision4 qualification runtime override shape is invalid', true)\n  }\n  return value\n}\n\nfunction selectionDigest(): string {\n  const value = revision4QualificationRuntimeOverride()?.selectionDigest\n    ?? env('XRPL_R5_REVISION4_SELECTION_DIGEST')\n  if (!/^[a-f0-9]{64}$/u.test(value)) {\n    throw new RecoveryError('XRPL_R5_REVISION4_SELECTION_DIGEST is invalid', true)\n  }\n  return value\n}\n\nfunction unexplainedDirectionalReserveBytes(): number {\n  const raw = revision4QualificationRuntimeOverride()?.unexplainedDirectionalReserveBytes\n    ?? env('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')\n  const value = Number(raw)\n  if (!Number.isSafeInteger(value) || value < 0) {\n    throw new RecoveryError(\n      'XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES is invalid',\n      true,\n    )\n  }\n  return value\n}\n`,
          'qualification override readers',
        )
        return { contents: source, loader: 'ts' }
      },
    )
  },
}

const result = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  format: 'esm',
  plugins: [qualificationTransform],
})
if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log)
  throw new Error(`qualification proof build failed with ${result.outputs.length} outputs`)
}
await writeFile(output, Buffer.from(await result.outputs[0].arrayBuffer()))
