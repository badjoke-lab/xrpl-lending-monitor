import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { assessD4Maintenance } from './db-less-d4-maintenance-policy.mjs'

if (process.argv.length !== 5) {
  process.stderr.write('Usage: node db-less-d4-maintenance-check.mjs <d3-channel.json> <d4-channel.json> <output.json>\n')
  process.exit(2)
}
try {
  const d3 = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const d4 = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  const status = assessD4Maintenance({ d3, d4, nowMs: Date.now() })
  const output = process.argv[4]
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(status, null, 2) + '\n', 'utf8')
  process.stdout.write(JSON.stringify(status, null, 2) + '\n')
} catch (error) {
  process.stderr.write('D4 unattended guard cannot verify state: '
    + (error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
