import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-collector-tick`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const maximumAttempts = 24
const delayMilliseconds = 15_000

function asNonNegativeInteger(value) {
  const parsed = typeof value === 'string' ? Number(value) : value
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function isLedgerHash(value) {
  return typeof value === 'string' && /^[A-F0-9]{64}$/.test(value)
}

function sanitizeRun(run) {
  return {
    status: run?.status ?? null,
    source: run?.source ?? null,
    started_at: run?.started_at ?? null,
    completed_at: run?.completed_at ?? null,
    validated_ledger_index: asNonNegativeInteger(run?.validated_ledger_index),
    validated_ledger_hash: run?.validated_ledger_hash ?? null,
    error_message: run?.error_message ?? null,
  }
}

function sanitizeHealth(payload) {
  const runtime = payload?.runtime ?? null
  return {
    ok: payload?.ok === true,
    service: payload?.service ?? null,
    profileId: payload?.profileId ?? null,
    runtime:
      runtime === null
        ? null
        : {
            profile_id: runtime.profile_id ?? null,
            network: runtime.network ?? null,
            status: runtime.status ?? null,
            lease_expires_at: runtime.lease_expires_at ?? null,
            last_started_at: runtime.last_started_at ?? null,
            last_completed_at: runtime.last_completed_at ?? null,
            last_failed_at: runtime.last_failed_at ?? null,
            last_validated_ledger_index: asNonNegativeInteger(
              runtime.last_validated_ledger_index,
            ),
            last_validated_ledger_hash:
              runtime.last_validated_ledger_hash ?? null,
            last_error: runtime.last_error ?? null,
            tick_count: asNonNegativeInteger(runtime.tick_count),
            consecutive_failures: asNonNegativeInteger(
              runtime.consecutive_failures,
            ),
            updated_at: runtime.updated_at ?? null,
          },
    recentRuns: Array.isArray(payload?.recentRuns)
      ? payload.recentRuns.slice(0, 5).map(sanitizeRun)
      : [],
    checkedAt: payload?.checkedAt ?? null,
  }
}

function evaluateHealth(health) {
  const runtime = health.runtime
  if (health.ok !== true) return 'health response is not ok'
  if (health.service !== 'xrpl-lending-monitor-supabase-probe') {
    return 'unexpected service identity'
  }
  if (health.profileId !== 'supabase-devnet') return 'unexpected profile identity'
  if (!runtime) return 'runtime row is not available yet'
  if (runtime.profile_id !== 'supabase-devnet') return 'runtime profile mismatch'
  if (runtime.network !== 'devnet') return 'runtime network is not Devnet'
  if (!['stopped', 'running'].includes(runtime.status)) {
    return `unexpected runtime status: ${String(runtime.status)}`
  }
  if ((runtime.tick_count ?? 0) < 2) return 'fewer than two completed ticks'
  if (runtime.consecutive_failures !== 0) return 'runtime has consecutive failures'
  if (runtime.last_error !== null) return 'runtime retains an error'
  if ((runtime.last_validated_ledger_index ?? 0) <= 0) {
    return 'validated ledger index is missing'
  }
  if (!isLedgerHash(runtime.last_validated_ledger_hash)) {
    return 'validated ledger hash is invalid'
  }

  const completedCronRuns = health.recentRuns.filter(
    (run) =>
      run.status === 'completed' &&
      run.source === 'pg_cron' &&
      (run.validated_ledger_index ?? 0) > 0 &&
      isLedgerHash(run.validated_ledger_hash) &&
      typeof run.started_at === 'string' &&
      typeof run.completed_at === 'string' &&
      run.error_message === null,
  )
  if (completedCronRuns.length < 2) return 'fewer than two successful pg_cron runs'
  if (
    completedCronRuns[0].validated_ledger_index <
    completedCronRuns[1].validated_ledger_index
  ) {
    return 'recent Cron ledger order is not descending'
  }
  return null
}

await mkdir(evidenceDirectory, { recursive: true })
let finalObservation = null
let finalReason = 'verification did not run'

for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    const text = await response.text()
    if (!response.ok) {
      finalReason = `health returned HTTP ${response.status}`
    } else {
      const payload = JSON.parse(text)
      finalObservation = sanitizeHealth(payload)
      finalReason = evaluateHealth(finalObservation)
      if (finalReason === null) {
        const evidence = {
          schemaVersion: 1,
          endpoint,
          verifiedAt: new Date().toISOString(),
          attempt,
          requirements: {
            minimumCompletedTicks: 2,
            minimumSuccessfulCronRuns: 2,
            network: 'devnet',
            profileId: 'supabase-devnet',
            consecutiveFailures: 0,
          },
          health: finalObservation,
        }
        await writeFile(
          `${evidenceDirectory}/verified-health.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        )
        console.log(
          `Supabase remote probe verified after ${attempt} attempt(s): tick_count=${finalObservation.runtime.tick_count}, ledger=${finalObservation.runtime.last_validated_ledger_index}`,
        )
        process.exit(0)
      }
    }
  } catch (error) {
    finalReason = error instanceof Error ? error.message : String(error)
  }

  console.log(
    `Supabase remote probe not ready (${attempt}/${maximumAttempts}): ${finalReason}`,
  )
  if (attempt < maximumAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds))
  }
}

await writeFile(
  `${evidenceDirectory}/failed-verification.json`,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      endpoint,
      failedAt: new Date().toISOString(),
      reason: finalReason,
      lastHealth: finalObservation,
    },
    null,
    2,
  )}\n`,
)
throw new Error(`Supabase remote probe verification failed: ${finalReason}`)
