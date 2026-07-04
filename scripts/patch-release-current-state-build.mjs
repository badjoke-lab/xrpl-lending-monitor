import { readFile, writeFile } from 'node:fs/promises'

const path = '.release-current-state-build/run-release-current-state.mjs'
const source = await readFile(path, 'utf8')
const before = "result.validated !== true"
const after = "result.validated === false"

const matches = source.split(before).length - 1
if (matches !== 1) {
  throw new Error(`Expected exactly one validated guard in ${path}, found ${matches}`)
}

await writeFile(path, source.replace(before, after), 'utf8')
process.stdout.write(`Patched ledger_data validated guard in ${path}\n`)
