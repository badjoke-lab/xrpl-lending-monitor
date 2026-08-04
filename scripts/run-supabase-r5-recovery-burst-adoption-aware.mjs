import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const sourcePath = 'scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs'
const generatedPath = `/tmp/xrpl-r5-recovery-burst-adoption-aware-${process.pid}.mjs`
const obsolete = `    adoption = normalizeAdoption(
      afterAdoptions.adoptions.at(-1),
      afterAdoptions.adoptionCount,
    )`
const corrected = `    adoption = normalizeAdoption(
      afterAdoptions.adoptions.at(-1),
      beforeAdoptions.adoptedBatchCount + 1,
    )`

const source = await readFile(sourcePath, 'utf8')
const occurrenceCount = source.split(obsolete).length - 1
if (occurrenceCount !== 1) {
  throw new Error(
    `R5 adoption sequence correction expected exactly one obsolete call, found ${occurrenceCount}`,
  )
}
if (source.includes(corrected)) {
  throw new Error('R5 adoption sequence correction is already present in source')
}

const generated = source.replace(obsolete, corrected)
if (generated === source || generated.includes(obsolete) || !generated.includes(corrected)) {
  throw new Error('R5 adoption sequence correction did not converge exactly')
}

await writeFile(generatedPath, generated, { encoding: 'utf8', mode: 0o600 })
try {
  await import(pathToFileURL(generatedPath).href)
} finally {
  await rm(generatedPath, { force: true })
}
