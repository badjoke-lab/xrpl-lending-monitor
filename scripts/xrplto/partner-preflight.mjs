#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

const API_KEY = process.env.XRPLTO_API_KEY?.trim() || ''
const OUTPUT_DIR =
  process.env.XRPLTO_PARTNER_PREFLIGHT_OUTPUT_DIR ||
  '.local/xrplto-partner-preflight'
const ENDPOINT = 'https://api.xrpl.to/v1/testnet/rpc'
const MIN_EXPECTED_LIMIT = Number.parseInt(
  process.env.XRPLTO_PARTNER_MIN_LIMIT || '100',
  10,
)

if (!API_KEY) throw new Error('XRPLTO_API_KEY is required')
if (!Number.isSafeInteger(MIN_EXPECTED_LIMIT) || MIN_EXPECTED_LIMIT < 1) {
  throw new Error('XRPLTO_PARTNER_MIN_LIMIT must be a positive integer')
}

await mkdir(OUTPUT_DIR, { recursive: true })

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent':
      'xrpl-lending-monitor-partner-preflight/1.0 (+https://github.com/badjoke-lab/xrpl-lending-monitor)',
    'x-api-key': API_KEY,
  },
  body: JSON.stringify({
    method: 'server_info',
    params: {},
  }),
})

const text = await response.text()
let body = null
try {
  body = JSON.parse(text)
} catch {}

const headers = {}
for (const name of [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-daily-remaining',
  'retry-after',
]) {
  const value = response.headers.get(name)
  if (value !== null) headers[name] = value
}

const observedLimit = Number.parseInt(headers['x-ratelimit-limit'] || '', 10)
const providerOk =
  response.ok &&
  body &&
  typeof body === 'object' &&
  body.success === true &&
  body.method === 'server_info' &&
  body.result &&
  typeof body.result === 'object'

const partnerLimitObserved =
  Number.isSafeInteger(observedLimit) &&
  observedLimit >= MIN_EXPECTED_LIMIT

const summary = {
  schemaVersion: 1,
  probe: 'xrplto-partner-preflight',
  completedAt: new Date().toISOString(),
  endpoint: ENDPOINT,
  httpStatus: response.status,
  providerOk: Boolean(providerOk),
  headers,
  minExpectedLimit: MIN_EXPECTED_LIMIT,
  observedLimit: Number.isSafeInteger(observedLimit) ? observedLimit : null,
  partnerLimitObserved,
  pass: Boolean(providerOk && partnerLimitObserved),
}

await writeFile(
  `${OUTPUT_DIR}/summary.json`,
  JSON.stringify(summary, null, 2) + '\n',
)

await writeFile(
  `${OUTPUT_DIR}/evidence.md`,
  [
    '# XRPL.to Partner preflight',
    '',
    `- provider response valid: **${providerOk ? 'YES' : 'NO'}**`,
    `- observed X-RateLimit-Limit: \`${summary.observedLimit ?? 'missing'}\``,
    `- required minimum: \`${MIN_EXPECTED_LIMIT}\``,
    `- Partner-class rate limit observed: **${partnerLimitObserved ? 'YES' : 'NO'}**`,
    '',
    'This gate prevents Partner benchmarks from running before the key is actually upgraded.',
    '',
  ].join('\n'),
)

console.log(JSON.stringify(summary, null, 2))

if (!summary.pass) process.exitCode = 2
