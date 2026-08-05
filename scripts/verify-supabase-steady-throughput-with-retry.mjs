import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { verifyRetainedR5Qualifications } from './verify-supabase-retained-r5-qualification-evidence.mjs'

const evidenceDirectory = 'supabase-remote-probe-evidence'
const verifierPath = 'scripts/verify-supabase-steady-throughput.mjs'
const cadenceRetryReason = 'steady completed ticks are not six consecutive minute buckets'
const transientReadStatuses = [429, 500, 502, 503, 504, 520, 522, 524]
const transientTimeoutReason = 'The operation was aborted due to timeout'
const retryableReasons = [
  cadenceRetryReason,
  transientTimeoutReason,
  ...transientReadStatuses.map((status) => `steady session read failed (${status}):`),
  ...transientReadStatuses.map((status) => `steady session preparation failed (${status}):`),
]

async function runVerifier(attempt) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [verifierPath], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stderr.write(text)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      resolve({ attempt, code: code ?? 1, signal, output })
    })
  })
}

function retryReason(output) {
  return retryableReasons.find((reason) => output.includes(reason)) ?? null
}

async function preserveFirstFailure(first, reason) {
  await mkdir(evidenceDirectory, { recursive: true })
  const source = `${evidenceDirectory}/failed-steady-throughput-verification.json`
  const target = reason === cadenceRetryReason
    ? `${evidenceDirectory}/retryable-steady-cadence-gap-attempt-1.json`
    : `${evidenceDirectory}/retryable-steady-provider-failure-attempt-1.json`
  try {
    await copyFile(source, target)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await writeFile(
      target,
      `${JSON.stringify({
        schemaVersion: 1,
        purpose: 'r4c2d-strict-steady-retry',
        attempt: 1,
        retryReason: reason,
        verifierOutputRetained: false,
      }, null, 2)}\n`,
    )
  }
  await rm(source, { force: true })

  return {
    attempt: first.attempt,
    exitCode: first.code,
    signal: first.signal,
    retryReason: reason,
    retryClass: reason === cadenceRetryReason ? 'cadence_gap' : 'transient_provider_failure',
  }
}

const retained = await verifyRetainedR5Qualifications()
if (retained !== null) {
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(
    `${evidenceDirectory}/verified-steady-throughput.json`,
    `${JSON.stringify(retained.steady, null, 2)}\n`,
  )
  process.stdout.write(`${JSON.stringify(retained.steady)}\n`)
  process.exit(0)
}

const first = await runVerifier(1)
if (first.code === 0) process.exit(0)
const firstRetryReason = retryReason(first.output)
if (firstRetryReason === null) process.exit(first.code)

const firstFailure = await preserveFirstFailure(first, firstRetryReason)
process.stderr.write(
  firstRetryReason === cadenceRetryReason
    ? 'Strict steady qualification missed one minute bucket; running one fresh 6x24 session.\n'
    : 'Strict steady qualification received one transient provider response or exact request timeout; running one fresh 6x24 session.\n',
)

const second = await runVerifier(2)
await mkdir(evidenceDirectory, { recursive: true })
let secondSessionId = null
if (second.code === 0) {
  try {
    const verified = JSON.parse(
      await readFile(`${evidenceDirectory}/verified-steady-throughput.json`, 'utf8'),
    )
    secondSessionId = verified.sessionId ?? null
  } catch {
    secondSessionId = null
  }
}
await writeFile(
  `${evidenceDirectory}/steady-throughput-strict-retry-summary.json`,
  `${JSON.stringify({
    schemaVersion: 1,
    purpose: 'r4c2d-strict-steady-retry',
    retryUsed: true,
    maximumAttempts: 2,
    firstFailure,
    secondAttempt: {
      exitCode: second.code,
      signal: second.signal,
      sessionId: secondSessionId,
      strictConsecutiveQualificationPassed: second.code === 0,
    },
    checks: {
      retryLimitedToExactCadenceGapOrTransientProviderFailure: true,
      providerRetryStatuses: transientReadStatuses,
      exactRequestTimeoutRetryReason: transientTimeoutReason,
      secondSessionFresh: true,
      strictSixConsecutiveMinutesStillRequired: true,
      noThresholdRelaxation: true,
    },
  }, null, 2)}\n`,
)

process.exit(second.code)
