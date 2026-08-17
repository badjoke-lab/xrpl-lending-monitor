#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const BASE_MANAGER = 'scripts/manage-r5-terminal-archive-phase-b-tranche.mjs'
const EXPECTED_BASE_SHA256 = '03d1af2aff0546a5c348e5847d19e2449d421fe25650b9ad52a588e2acd87b43'
const SOURCE_MARKER = 'const TRANCHE_LIMIT = 250'
const RAMP_MARKER = 'const TRANCHE_LIMIT = 500'
const BYTE_LIMIT_MARKER = 'const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000'

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const source = await readFile(BASE_MANAGER, 'utf8')
if (sha256(source) !== EXPECTED_BASE_SHA256) fail('Phase B base manager SHA-256 drifted')
if (source.split(SOURCE_MARKER).length !== 2) fail('Phase B 250-row marker is not unique')
if (!source.includes(BYTE_LIMIT_MARKER)) fail('Phase B 2MB logical-byte limit drifted')
if (source.includes(RAMP_MARKER)) fail('Phase B base manager is already ramped')

const ramped = source.replace(SOURCE_MARKER, RAMP_MARKER)
if (!ramped.includes(RAMP_MARKER) || !ramped.includes(BYTE_LIMIT_MARKER)) fail('Phase B 500-row transform failed')
if (ramped.includes(SOURCE_MARKER)) fail('Phase B 250-row marker survived transform')

const generated = resolve('.r5-phase-b-500-ramp-manager.mjs')
await writeFile(generated, ramped, { mode: 0o600 })
try {
  const child = spawnSync(process.execPath, [generated, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  if (child.error) throw child.error
  if (child.signal) fail(`Phase B 500-row manager terminated by ${child.signal}`)
  process.exitCode = child.status ?? 1
} finally {
  await rm(generated, { force: true })
}
