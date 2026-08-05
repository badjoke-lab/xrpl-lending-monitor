import { chmod, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const strictPath = resolve(
  scriptDirectory,
  'verify-supabase-r5-first-recovery-batch-strict.mjs',
)
const generatedPath = resolve(
  scriptDirectory,
  `.verify-supabase-r5-first-recovery-batch-generated-${process.pid}.mjs`,
)

const oldGuard = `    || after.startedAt === null
    || after.checks.activeRecoveryStarted !== (after.status === 'running')
    || requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1
    || requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0
    || requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0
    || requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0
    || requiredInteger(`

const newGuard = `    || after.startedAt === null
    || after.checks.activeRecoveryStarted !== (after.status === 'running')
    || (exactFirstBatchOnly && (
      requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1
      || requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0
      || requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0
      || requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0
    ))
    || requiredInteger(`

function replaceExactlyOnce(source, oldText, newText, name) {
  const oldCount = source.split(oldText).length - 1
  const newCount = source.split(newText).length - 1
  if (oldCount !== 1 || newCount !== 0) {
    throw new Error(`${name} source shape changed`)
  }
  const updated = source.replace(oldText, newText)
  if (
    updated.split(oldText).length - 1 !== 0
    || updated.split(newText).length - 1 !== 1
  ) {
    throw new Error(`${name} did not converge exactly`)
  }
  return updated
}

let generated
try {
  const strictSource = await readFile(strictPath, 'utf8')
  generated = replaceExactlyOnce(
    strictSource,
    oldGuard,
    newGuard,
    'R5 mature recovery queue parity guard',
  )
  await writeFile(generatedPath, generated, { mode: 0o600 })
  await chmod(generatedPath, 0o600)
  await import(pathToFileURL(generatedPath).href)
} finally {
  await unlink(generatedPath).catch(() => {})
}
