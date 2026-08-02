import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-collector-tick`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const maximumAttempts = 48
const delayMilliseconds = 15_000
const phaseEpochId = 'supabase-r4c2c-v1'
const semanticCountKeys = {
  'validated-ledger': 'validatedLedgers',
  'protocol-event': 'protocolEvents',
  'object-change': 'objectChanges',
  'loan-lifecycle': 'loanLifecycleEvents',
  'archived-object': 'archivedObjects',
  'balance-history': 'balanceHistory',
  'current-projection': 'currentProjectionMutations',
}

function asNonNegativeInteger(value) {
  const parsed = typeof value === 'string' ? Number(value) : value
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function isLedgerHash(value) {
  return typeof value === 'string' && /^[A-F0-9]{64}$/.test(value)
}

function parseCanonicalObject(value) {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
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
    epoch_id: work?.epoch_id ?? null,
    previous_ledger_index: asNonNegativeInteger(work?.previous_ledger_index),
    start_ledger_index: asNonNegativeInteger(work?.start_ledger_index),
    expected_parent_hash: work?.expected_parent_hash ?? null,
    scanned_end_ledger_index: asNonNegativeInteger(work?.scanned_end_ledger_index),
    final_ledger_hash: work?.final_ledger_hash ?? null,
    status: work?.status ?? null,
    semantic_counts_json: work?.semantic_counts_json ?? null,
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
    source_transaction_hash: row?.source_transaction_hash ?? null,
    object_id: row?.object_id ?? null,
    relationship_ids: Array.isArray(row?.relationship_ids) ? row.relationship_ids : null,
    value_json: row?.value_json ?? null,
    is_tombstone: row?.is_tombstone ?? null,
    created_at: row?.created_at ?? null,
  }
}

function sanitizePhaseChain(phaseChain) {
  const stream = phaseChain?.stream ?? null
  const watermark = phaseChain?.watermark ?? null
  const latestCommittedWork = phaseChain?.latestCommittedWork ?? null
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
      ? phaseChain.recentMessages.slice(0, 320).map(sanitizeMessage)
      : [],
    recentWorks: Array.isArray(phaseChain?.recentWorks)
      ? phaseChain.recentWorks.slice(0, 8).map(sanitizeWork)
      : [],
    latestCommittedWork:
      latestCommittedWork === null ? null : sanitizeWork(latestCommittedWork),
    committedRows: Array.isArray(phaseChain?.committedRows)
      ? phaseChain.committedRows.slice(0, 400).map(sanitizeCommittedRow)
      : [],
    semanticClassCounts:
      phaseChain?.semanticClassCounts && typeof phaseChain.semanticClassCounts === 'object'
        ? Object.fromEntries(
            Object.keys(semanticCountKeys).map((semanticClass) => [
              semanticClass,
              asNonNegativeInteger(phaseChain.semanticClassCounts[semanticClass]),
            ]),
          )
        : {},
  }
}

function sanitizeHealth(payload) {
  const runtime = payload?.runtime ?? null
  return {
    ok: payload?.ok === true,
    service: payload?.service ?? null,
    profileId: payload?.profileId ?? null,
    phaseEpochId: payload?.phaseEpochId ?? null,
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
            last_validated_ledger_hash: runtime.last_validated_ledger_hash ?? null,
            last_error: runtime.last_error ?? null,
            tick_count: asNonNegativeInteger(runtime.tick_count),
            consecutive_failures: asNonNegativeInteger(runtime.consecutive_failures),
            updated_at: runtime.updated_at ?? null,
          },
    recentRuns: Array.isArray(payload?.recentRuns)
      ? payload.recentRuns.slice(0, 5).map(sanitizeRun)
      : [],
    phaseChain: sanitizePhaseChain(payload?.phaseChain),
    checkedAt: payload?.checkedAt ?? null,
  }
}

function findCompletedChain(messages, watermark, work) {
  const byId = new Map(
    messages
      .filter((message) => typeof message.message_id === 'string')
      .map((message) => [message.message_id, message]),
  )
  const finalize = messages.find(
    (message) =>
      message.phase === 'finalize' &&
      message.status === 'completed' &&
      message.result?.status === 'committed' &&
      message.result?.workId === watermark.work_id &&
      asNonNegativeInteger(message.result?.ledgerIndex) === watermark.ledger_index &&
      message.result?.ledgerHash === watermark.ledger_hash,
  )
  if (!finalize) return null

  const commits = messages
    .filter(
      (message) =>
        message.phase === 'commit' &&
        message.status === 'completed' &&
        message.result?.workId === watermark.work_id,
    )
    .sort(
      (left, right) =>
        asNonNegativeInteger(left.result?.chunkIndex) -
        asNonNegativeInteger(right.result?.chunkIndex),
    )
  if (commits.length !== work.expected_commit_chunks) return null
  for (let index = 0; index < commits.length; index += 1) {
    if (asNonNegativeInteger(commits[index]?.result?.chunkIndex) !== index) return null
    const expectedSuccessor = index + 1 < commits.length
      ? commits[index + 1]?.message_id
      : finalize.message_id
    if (commits[index]?.successor_message_id !== expectedSuccessor) return null
  }

  const scan = messages.find(
    (message) =>
      message.phase === 'scan' &&
      message.status === 'completed' &&
      message.successor_message_id === commits[0]?.message_id &&
      message.result?.status === 'staged' &&
      message.result?.workId === watermark.work_id,
  )
  if (!scan) return null
  const successor = byId.get(finalize.successor_message_id)
  if (
    !successor ||
    !['pending', 'leased', 'retry', 'completed'].includes(successor.status) ||
    successor.phase !== 'scan'
  ) {
    return null
  }
  return { scan, commits, finalize, successor }
}

function evaluateHealth(health) {
  const runtime = health.runtime
  if (health.ok !== true) return 'health response is not ok'
  if (health.service !== 'xrpl-lending-monitor-supabase-probe') {
    return 'unexpected service identity'
  }
  if (health.profileId !== 'supabase-devnet') return 'unexpected profile identity'
  if (health.phaseEpochId !== phaseEpochId) return 'unexpected phase epoch identity'
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
  if (completedCronRuns[0].validated_ledger_index < completedCronRuns[1].validated_ledger_index) {
    return 'recent Cron ledger order is not descending'
  }

  const chain = health.phaseChain
  const stream = chain.stream
  const watermark = chain.watermark
  const work = chain.latestCommittedWork
  if (!stream) return 'portable phase stream is not available yet'
  if (stream.profile_id !== 'supabase-devnet') return 'phase stream profile mismatch'
  if (stream.network !== 'devnet') return 'phase stream network mismatch'
  if (stream.epoch_id !== phaseEpochId) return 'phase stream epoch mismatch'
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

  const terminalMessages = chain.recentMessages.filter(
    (message) =>
      message.status === 'error' && message.error_classification !== 'superseded_epoch',
  )
  if (terminalMessages.length > 0) return 'current phase messages contain a terminal error'

  if (!work || work.work_id !== watermark.work_id) {
    return 'latest committed work does not match the watermark'
  }
  if (work.epoch_id !== phaseEpochId) return 'watermark work epoch mismatch'
  if (work.status !== 'committed' || work.committed_at === null) {
    return 'watermark work is not committed'
  }
  if (
    work.scanned_end_ledger_index !== watermark.ledger_index ||
    work.final_ledger_hash !== watermark.ledger_hash ||
    (work.expected_payload_chunks ?? 0) < 1 ||
    work.expected_payload_chunks !== work.expected_commit_chunks ||
    typeof work.payload_digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(work.payload_digest)
  ) {
    return 'watermark work identity is incomplete or inconsistent'
  }

  const semanticCounts = parseCanonicalObject(work.semantic_counts_json)
  if (!semanticCounts) return 'semantic counts are missing or invalid'
  const totalRecords = asNonNegativeInteger(semanticCounts.totalRecords)
  if (totalRecords === null || totalRecords < 1) return 'semantic total record count is invalid'
  if (asNonNegativeInteger(semanticCounts.validatedLedgers) !== 1) {
    return 'latest work does not contain exactly one validated ledger'
  }
  if (chain.committedRows.length !== totalRecords) {
    return 'committed-only row count does not match semantic counts'
  }

  for (const [semanticClass, countKey] of Object.entries(semanticCountKeys)) {
    const expectedCount = asNonNegativeInteger(semanticCounts[countKey])
    const observedCount = chain.semanticClassCounts[semanticClass]
    if (expectedCount === null || observedCount !== expectedCount) {
      return `semantic count mismatch for ${semanticClass}`
    }
  }

  if (
    chain.committedRows.some(
      (row) =>
        row.work_id !== watermark.work_id ||
        row.source_ledger_index !== watermark.ledger_index ||
        row.source_ledger_hash !== watermark.ledger_hash ||
        !Array.isArray(row.relationship_ids),
    )
  ) {
    return 'committed-only row provenance does not match the watermark work'
  }
  const ledgerRow = chain.committedRows.find(
    (row) => row.semantic_class === 'validated-ledger',
  )
  if (
    !ledgerRow ||
    ledgerRow.canonical_key !== `ledger:${watermark.ledger_index}` ||
    ledgerRow.source_transaction_hash !== null ||
    ledgerRow.object_id !== null ||
    ledgerRow.is_tombstone !== false ||
    typeof ledgerRow.value_json !== 'string'
  ) {
    return 'validated-ledger row identity does not match the watermark'
  }
  if (
    chain.committedRows.some(
      (row) =>
        row.semantic_class !== 'validated-ledger' &&
        (typeof row.source_transaction_hash !== 'string' ||
          !/^[A-F0-9]{64}$/.test(row.source_transaction_hash)),
    )
  ) {
    return 'transaction-bound semantic row has an invalid transaction identity'
  }
  if (
    chain.committedRows.some(
      (row) =>
        row.semantic_class === 'current-projection' &&
        row.is_tombstone === true &&
        row.value_json !== null,
    )
  ) {
    return 'current-projection tombstone exposes a value'
  }

  const completedChain = findCompletedChain(chain.recentMessages, watermark, work)
  if (!completedChain) {
    return 'scan, ordered commits, finalize, and successor chain is not complete yet'
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
          schemaVersion: 3,
          endpoint,
          verifiedAt: new Date().toISOString(),
          attempt,
          requirements: {
            minimumCompletedTicks: 2,
            minimumSuccessfulCronRuns: 2,
            network: 'devnet',
            profileId: 'supabase-devnet',
            phaseEpochId,
            requiredPhases: ['scan', 'commit', 'finalize'],
            orderedMultiChunkCommits: true,
            sevenClassEnvelope: true,
            committedOnlyVisibility: true,
            semanticCountParity: true,
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
          `Supabase seven-class portable work verified after ${attempt} attempt(s): tick_count=${finalObservation.runtime.tick_count}, watermark=${finalObservation.phaseChain.watermark.ledger_index}, records=${finalObservation.phaseChain.committedRows.length}`,
        )
        process.exit(0)
      }
    }
  } catch (error) {
    finalReason = error instanceof Error ? error.message : String(error)
  }

  console.log(
    `Supabase seven-class phase chain not ready (${attempt}/${maximumAttempts}): ${finalReason}`,
  )
  if (attempt < maximumAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds))
  }
}

await writeFile(
  `${evidenceDirectory}/failed-verification.json`,
  `${JSON.stringify(
    {
      schemaVersion: 3,
      endpoint,
      failedAt: new Date().toISOString(),
      reason: finalReason,
      lastHealth: finalObservation,
    },
    null,
    2,
  )}\n`,
)
throw new Error(`Supabase seven-class phase-chain verification failed: ${finalReason}`)
