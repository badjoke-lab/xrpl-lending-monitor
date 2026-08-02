import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-collector-tick`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const maximumAttempts = 36
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

function sanitizeMessage(message) {
  return {
    message_id: message?.message_id ?? null,
    phase: message?.phase ?? null,
    status: message?.status ?? null,
    available_at: message?.available_at ?? null,
    attempt_count: asNonNegativeInteger(message?.attempt_count),
    lease_expires_at: message?.lease_expires_at ?? null,
    result: message?.result ?? null,
    successor_message_id: message?.successor_message_id ?? null,
    error_classification: message?.error_classification ?? null,
    error_message: message?.error_message ?? null,
    created_at: message?.created_at ?? null,
    updated_at: message?.updated_at ?? null,
    completed_at: message?.completed_at ?? null,
  }
}

function sanitizeWork(work) {
  return {
    work_id: work?.work_id ?? null,
    previous_ledger_index: asNonNegativeInteger(work?.previous_ledger_index),
    start_ledger_index: asNonNegativeInteger(work?.start_ledger_index),
    expected_parent_hash: work?.expected_parent_hash ?? null,
    scanned_end_ledger_index: asNonNegativeInteger(work?.scanned_end_ledger_index),
    final_ledger_hash: work?.final_ledger_hash ?? null,
    status: work?.status ?? null,
    payload_digest: work?.payload_digest ?? null,
    expected_payload_chunks: asNonNegativeInteger(work?.expected_payload_chunks),
    expected_commit_chunks: asNonNegativeInteger(work?.expected_commit_chunks),
    created_at: work?.created_at ?? null,
    updated_at: work?.updated_at ?? null,
    committed_at: work?.committed_at ?? null,
  }
}

function sanitizeCommittedRow(row) {
  return {
    work_id: row?.work_id ?? null,
    semantic_class: row?.semantic_class ?? null,
    canonical_key: row?.canonical_key ?? null,
    source_ledger_index: asNonNegativeInteger(row?.source_ledger_index),
    source_ledger_hash: row?.source_ledger_hash ?? null,
    value_json: row?.value_json ?? null,
    is_tombstone: row?.is_tombstone ?? null,
    created_at: row?.created_at ?? null,
  }
}

function sanitizePhaseChain(phaseChain) {
  const stream = phaseChain?.stream ?? null
  const watermark = phaseChain?.watermark ?? null
  return {
    stream:
      stream === null
        ? null
        : {
            profile_id: stream.profile_id ?? null,
            network: stream.network ?? null,
            epoch_id: stream.epoch_id ?? null,
            base_identity: stream.base_identity ?? null,
            immutable_base_ledger_index: asNonNegativeInteger(
              stream.immutable_base_ledger_index,
            ),
            immutable_base_ledger_hash: stream.immutable_base_ledger_hash ?? null,
            status: stream.status ?? null,
            last_error_classification: stream.last_error_classification ?? null,
            last_error_message: stream.last_error_message ?? null,
            created_at: stream.created_at ?? null,
            updated_at: stream.updated_at ?? null,
          },
    watermark:
      watermark === null
        ? null
        : {
            profile_id: watermark.profile_id ?? null,
            network: watermark.network ?? null,
            epoch_id: watermark.epoch_id ?? null,
            base_identity: watermark.base_identity ?? null,
            ledger_index: asNonNegativeInteger(watermark.ledger_index),
            ledger_hash: watermark.ledger_hash ?? null,
            work_id: watermark.work_id ?? null,
            updated_at: watermark.updated_at ?? null,
          },
    recentMessages: Array.isArray(phaseChain?.recentMessages)
      ? phaseChain.recentMessages.slice(0, 12).map(sanitizeMessage)
      : [],
    recentWorks: Array.isArray(phaseChain?.recentWorks)
      ? phaseChain.recentWorks.slice(0, 5).map(sanitizeWork)
      : [],
    committedRows: Array.isArray(phaseChain?.committedRows)
      ? phaseChain.committedRows.slice(0, 5).map(sanitizeCommittedRow)
      : [],
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
    phaseChain: sanitizePhaseChain(payload?.phaseChain),
    checkedAt: payload?.checkedAt ?? null,
  }
}

function findCompletedChain(messages, watermark) {
  const byId = new Map(
    messages
      .filter((message) => typeof message.message_id === 'string')
      .map((message) => [message.message_id, message]),
  )
  for (const finalize of messages) {
    if (
      finalize.phase !== 'finalize' ||
      finalize.status !== 'completed' ||
      finalize.result?.status !== 'committed' ||
      finalize.result?.workId !== watermark.work_id ||
      asNonNegativeInteger(finalize.result?.ledgerIndex) !== watermark.ledger_index ||
      finalize.result?.ledgerHash !== watermark.ledger_hash
    ) {
      continue
    }
    const commit = messages.find(
      (message) =>
        message.phase === 'commit' &&
        message.status === 'completed' &&
        message.successor_message_id === finalize.message_id &&
        message.result?.workId === watermark.work_id,
    )
    if (!commit) continue
    const scan = messages.find(
      (message) =>
        message.phase === 'scan' &&
        message.status === 'completed' &&
        message.successor_message_id === commit.message_id &&
        message.result?.status === 'staged' &&
        message.result?.workId === watermark.work_id,
    )
    if (!scan) continue
    const successor = byId.get(finalize.successor_message_id)
    if (
      !successor ||
      !['pending', 'leased', 'retry', 'completed'].includes(successor.status) ||
      successor.phase !== 'scan'
    ) {
      continue
    }
    return { scan, commit, finalize, successor }
  }
  return null
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

  const chain = health.phaseChain
  const stream = chain.stream
  const watermark = chain.watermark
  if (!stream) return 'portable phase stream is not available yet'
  if (stream.profile_id !== 'supabase-devnet') return 'phase stream profile mismatch'
  if (stream.network !== 'devnet') return 'phase stream network mismatch'
  if (stream.epoch_id !== 'supabase-r4c2b-v1') return 'phase stream epoch mismatch'
  if (stream.status !== 'active') return `phase stream is ${String(stream.status)}`
  if (stream.last_error_classification !== null || stream.last_error_message !== null) {
    return 'phase stream retains a terminal error'
  }
  if ((stream.immutable_base_ledger_index ?? 0) <= 0) {
    return 'phase stream base ledger is missing'
  }
  if (!isLedgerHash(stream.immutable_base_ledger_hash)) {
    return 'phase stream base hash is invalid'
  }
  if (!watermark) return 'portable phase watermark is not available yet'
  if (watermark.profile_id !== stream.profile_id) return 'watermark profile mismatch'
  if (watermark.network !== stream.network) return 'watermark network mismatch'
  if (watermark.epoch_id !== stream.epoch_id) return 'watermark epoch mismatch'
  if (watermark.base_identity !== stream.base_identity) return 'watermark base mismatch'
  if ((watermark.ledger_index ?? 0) <= stream.immutable_base_ledger_index) {
    return 'watermark has not advanced beyond the immutable base'
  }
  if (!isLedgerHash(watermark.ledger_hash)) return 'watermark hash is invalid'
  if (typeof watermark.work_id !== 'string' || watermark.work_id.length === 0) {
    return 'watermark work identity is missing'
  }
  if (chain.recentMessages.some((message) => message.status === 'error')) {
    return 'recent phase messages contain a terminal error'
  }

  const work = chain.recentWorks.find(
    (candidate) => candidate.work_id === watermark.work_id,
  )
  if (!work) return 'watermark work is not retained in recent work evidence'
  if (work.status !== 'committed' || work.committed_at === null) {
    return 'watermark work is not committed'
  }
  if (
    work.scanned_end_ledger_index !== watermark.ledger_index ||
    work.final_ledger_hash !== watermark.ledger_hash ||
    work.expected_payload_chunks !== 1 ||
    work.expected_commit_chunks !== 1 ||
    typeof work.payload_digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(work.payload_digest)
  ) {
    return 'watermark work identity is incomplete or inconsistent'
  }

  const committedRow = chain.committedRows.find(
    (row) => row.work_id === watermark.work_id,
  )
  if (!committedRow) return 'committed row is not visible at the watermark'
  if (
    committedRow.semantic_class !== 'validated-ledger' ||
    committedRow.canonical_key !== `ledger:${watermark.ledger_index}` ||
    committedRow.source_ledger_index !== watermark.ledger_index ||
    committedRow.source_ledger_hash !== watermark.ledger_hash ||
    committedRow.is_tombstone !== false ||
    typeof committedRow.value_json !== 'string'
  ) {
    return 'committed row identity does not match the watermark'
  }

  const completedChain = findCompletedChain(chain.recentMessages, watermark)
  if (!completedChain) {
    return 'scan, commit, finalize, and successor chain is not complete yet'
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
          schemaVersion: 2,
          endpoint,
          verifiedAt: new Date().toISOString(),
          attempt,
          requirements: {
            minimumCompletedTicks: 2,
            minimumSuccessfulCronRuns: 2,
            network: 'devnet',
            profileId: 'supabase-devnet',
            phaseEpochId: 'supabase-r4c2b-v1',
            requiredPhases: ['scan', 'commit', 'finalize'],
            committedOnlyVisibility: true,
            successorContinuation: true,
            consecutiveFailures: 0,
          },
          health: finalObservation,
        }
        await writeFile(
          `${evidenceDirectory}/verified-health.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        )
        console.log(
          `Supabase portable phase chain verified after ${attempt} attempt(s): tick_count=${finalObservation.runtime.tick_count}, watermark=${finalObservation.phaseChain.watermark.ledger_index}`,
        )
        process.exit(0)
      }
    }
  } catch (error) {
    finalReason = error instanceof Error ? error.message : String(error)
  }

  console.log(
    `Supabase remote phase chain not ready (${attempt}/${maximumAttempts}): ${finalReason}`,
  )
  if (attempt < maximumAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds))
  }
}

await writeFile(
  `${evidenceDirectory}/failed-verification.json`,
  `${JSON.stringify(
    {
      schemaVersion: 2,
      endpoint,
      failedAt: new Date().toISOString(),
      reason: finalReason,
      lastHealth: finalObservation,
    },
    null,
    2,
  )}\n`,
)
throw new Error(`Supabase remote phase-chain verification failed: ${finalReason}`)
