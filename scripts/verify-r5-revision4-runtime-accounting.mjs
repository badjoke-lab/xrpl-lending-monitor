import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path) throw new Error('usage: node scripts/verify-r5-revision4-runtime-accounting.mjs <json>')

const input = JSON.parse(await readFile(path, 'utf8'))
if (input.schemaVersion !== 1) throw new Error('schemaVersion must be 1')
if (input.qualification !== false) throw new Error('example must remain non-qualifying')
if (!Number.isSafeInteger(input.ledgerCount) || input.ledgerCount < 1 || input.ledgerCount > 12) {
  throw new Error('ledgerCount must be within the 12-ledger claim cap')
}
for (const [name, value] of Object.entries(input.wire ?? {})) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`wire.${name} must be a non-negative integer`)
}
for (const [name, value] of Object.entries(input.memory ?? {})) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`memory.${name} must be a non-negative integer`)
}
if (!Number.isSafeInteger(input.unexplainedDirectionalDeltaReserveBytes) || input.unexplainedDirectionalDeltaReserveBytes < 0) {
  throw new Error('unexplainedDirectionalDeltaReserveBytes must be a non-negative integer')
}

const minutes31d = 31 * 24 * 60
const projectEgressHaltBytes = 4 * 1024 * 1024 * 1024
const requiredLedgers = 21 * minutes31d
const maximumAverageBillableEgressBytesPerLedger = Math.floor(projectEgressHaltBytes / requiredLedgers)

process.stdout.write(`${JSON.stringify({
  ok: true,
  qualification: false,
  ledgerCount: input.ledgerCount,
  maximumAverageBillableEgressBytesPerLedger,
})}\n`)
