const PURPOSE = 'r4c2d-isolated-catchup-throughput'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const TRIAL_COUNT = 5
const SOURCE_COUNT = 64
const CATCH_UP_THRESHOLD = 30

type JsonObject = Record<string, unknown>

type TrialEvidence = {
  trialId: string
  status: string
  sourceCount: number
  sourceStartLedgerIndex: number
  sourceEndLedgerIndex: number
  sourceEndLedgerHash: string
  dbElapsedMilliseconds: number
  edgeWallMilliseconds: number
  effectiveElapsedMilliseconds: number
  committedLedgersPerMinute: number
  committedWorks: number
  sourceRowCount: number
  targetRowCount: number
  sourceRowsDigest: string
  targetRowsDigest: string
  messages: {
    total: number
    completed: number
    pending: number
    completedAttemptOne: number
  }
  successors: number
  targetWatermark: JsonObject
  activeBefore: JsonObject
  activeAfter: JsonObject
  checks: Record<string, boolean>
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function secretKey(): string {
  const packed = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (packed) {
    const parsed = JSON.parse(packed) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as JsonObject
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function numberValue(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`)
  }
  return parsed
}

function integerValue(value: unknown, name: string): number {
  const parsed = numberValue(value, name)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`)
  return parsed
}

function booleanChecks(value: unknown, name: string): Record<string, boolean> {
  const parsed = object(value, name)
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => {
      if (typeof item !== 'boolean') throw new Error(`${name}.${key} must be boolean`)
      return [key, item]
    }),
  )
}

async function rpc<T>(functionName: string, body: JsonObject): Promise<T> {
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: secretKey(),
      authorization: `Bearer ${secretKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${functionName} failed (${response.status}): ${text.slice(0, 1_000)}`)
  }
  return JSON.parse(text) as T
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) throw new Error('percentile requires values')
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]!
  const weight = position - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

function parseTrial(raw: unknown, edgeWallMilliseconds: number): TrialEvidence {
  const value = object(raw, 'catch-up trial')
  const messages = object(value.messages, 'catch-up trial messages')
  const checks = booleanChecks(value.checks, 'catch-up trial checks')
  const dbElapsedMilliseconds = numberValue(
    value.dbElapsedMilliseconds,
    'dbElapsedMilliseconds',
  )
  const effectiveElapsedMilliseconds = Math.max(dbElapsedMilliseconds, edgeWallMilliseconds)
  const committedLedgersPerMinute = SOURCE_COUNT * 60_000 / effectiveElapsedMilliseconds

  return {
    trialId: stringValue(value.trialId, 'trialId'),
    status: stringValue(value.status, 'status'),
    sourceCount: integerValue(value.sourceCount, 'sourceCount'),
    sourceStartLedgerIndex: integerValue(value.sourceStartLedgerIndex, 'sourceStartLedgerIndex'),
    sourceEndLedgerIndex: integerValue(value.sourceEndLedgerIndex, 'sourceEndLedgerIndex'),
    sourceEndLedgerHash: stringValue(value.sourceEndLedgerHash, 'sourceEndLedgerHash'),
    dbElapsedMilliseconds,
    edgeWallMilliseconds,
    effectiveElapsedMilliseconds,
    committedLedgersPerMinute,
    committedWorks: integerValue(value.committedWorks, 'committedWorks'),
    sourceRowCount: integerValue(value.sourceRowCount, 'sourceRowCount'),
    targetRowCount: integerValue(value.targetRowCount, 'targetRowCount'),
    sourceRowsDigest: stringValue(value.sourceRowsDigest, 'sourceRowsDigest'),
    targetRowsDigest: stringValue(value.targetRowsDigest, 'targetRowsDigest'),
    messages: {
      total: integerValue(messages.total, 'messages.total'),
      completed: integerValue(messages.completed, 'messages.completed'),
      pending: integerValue(messages.pending, 'messages.pending'),
      completedAttemptOne: integerValue(
        messages.completedAttemptOne,
        'messages.completedAttemptOne',
      ),
    },
    successors: integerValue(value.successors, 'successors'),
    targetWatermark: object(value.targetWatermark, 'targetWatermark'),
    activeBefore: object(value.activeBefore, 'activeBefore'),
    activeAfter: object(value.activeAfter, 'activeAfter'),
    checks,
  }
}

function verifyTrial(trial: TrialEvidence): void {
  if (
    trial.status !== 'completed'
    || trial.sourceCount !== SOURCE_COUNT
    || trial.committedWorks !== SOURCE_COUNT
    || trial.messages.total !== 193
    || trial.messages.completed !== 192
    || trial.messages.pending !== 1
    || trial.messages.completedAttemptOne !== 192
    || trial.successors !== 192
    || trial.sourceRowCount !== trial.targetRowCount
    || trial.sourceRowsDigest !== trial.targetRowsDigest
    || trial.targetWatermark.ledgerIndex !== trial.sourceEndLedgerIndex
    || trial.targetWatermark.ledgerHash !== trial.sourceEndLedgerHash
  ) {
    throw new Error(`catch-up trial ${trial.trialId} failed structural parity`)
  }
  for (const [name, passed] of Object.entries(trial.checks)) {
    if (!passed) throw new Error(`catch-up trial ${trial.trialId} check ${name} failed`)
  }
  const activeBefore = integerValue(trial.activeBefore.ledgerIndex, 'activeBefore.ledgerIndex')
  const activeAfter = integerValue(trial.activeAfter.ledgerIndex, 'activeAfter.ledgerIndex')
  if (activeAfter < activeBefore) {
    throw new Error(`catch-up trial ${trial.trialId} regressed the active watermark`)
  }
}

async function execute(runId: string): Promise<JsonObject> {
  const trials: TrialEvidence[] = []
  for (let index = 0; index < TRIAL_COUNT; index += 1) {
    const trialId = `${runId}-t${index + 1}`
    await rpc<JsonObject>('xrpl_prepare_isolated_catchup_trial', {
      p_trial_id: trialId,
      p_source_count: SOURCE_COUNT,
      p_prepared_at: new Date().toISOString(),
    })
    const wallStart = performance.now()
    const raw = await rpc<JsonObject>('xrpl_execute_isolated_catchup_trial', {
      p_trial_id: trialId,
      p_started_at: new Date().toISOString(),
    })
    const edgeWallMilliseconds = performance.now() - wallStart
    const trial = parseTrial(raw, edgeWallMilliseconds)
    verifyTrial(trial)
    trials.push(trial)
  }

  const rates = trials.map((trial) => trial.committedLedgersPerMinute)
  const dbElapsed = trials.map((trial) => trial.dbElapsedMilliseconds)
  const edgeElapsed = trials.map((trial) => trial.edgeWallMilliseconds)
  const p50 = percentile(rates, 0.5)
  const p95 = percentile(rates, 0.95)
  const catchUpObservedPass = p95 > CATCH_UP_THRESHOLD

  const first = trials[0]!
  const last = trials[trials.length - 1]!
  const activeBeforeLedger = integerValue(first.activeBefore.ledgerIndex, 'activeBefore.ledgerIndex')
  const activeAfterLedger = integerValue(last.activeAfter.ledgerIndex, 'activeAfter.ledgerIndex')

  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    profileId: 'supabase-devnet-catchup-qualification',
    sourceProfileId: 'supabase-devnet',
    network: 'devnet',
    sourceCount: SOURCE_COUNT,
    trialCount: TRIAL_COUNT,
    trials,
    summary: {
      minimumCommittedLedgersPerMinute: Math.min(...rates),
      p50CommittedLedgersPerMinute: p50,
      p95CommittedLedgersPerMinute: p95,
      maximumCommittedLedgersPerMinute: Math.max(...rates),
      p50DbElapsedMilliseconds: percentile(dbElapsed, 0.5),
      p95DbElapsedMilliseconds: percentile(dbElapsed, 0.95),
      p50EdgeWallMilliseconds: percentile(edgeElapsed, 0.5),
      p95EdgeWallMilliseconds: percentile(edgeElapsed, 0.95),
      catchUpThreshold: CATCH_UP_THRESHOLD,
      catchUpObservedPass,
      steadyObservedPass: false,
      steadyEvidenceSource: 'r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03',
      g7Qualified: false,
      g7Reason: catchUpObservedPass
        ? 'isolated catch-up passed, but retained steady p95 remains below the fixed threshold'
        : 'isolated catch-up and retained steady throughput do not both pass',
    },
    activeIsolation: {
      activeBeforeLedger,
      activeAfterLedger,
      nonRegressing: activeAfterLedger >= activeBeforeLedger,
      sourceProfileReadOnly: true,
    },
    checks: {
      fiveTrialsCompleted: trials.length === TRIAL_COUNT,
      sixtyFourWorksPerTrial: trials.every((trial) => trial.committedWorks === SOURCE_COUNT),
      fullPhaseSchedulerParity: trials.every(
        (trial) => trial.messages.completed === 192 && trial.successors === 192,
      ),
      allCompletedAttemptsOne: trials.every(
        (trial) => trial.messages.completedAttemptOne === 192,
      ),
      committedRowDigestParity: trials.every(
        (trial) => trial.sourceRowsDigest === trial.targetRowsDigest,
      ),
      targetWatermarkParity: trials.every(
        (trial) => trial.targetWatermark.ledgerIndex === trial.sourceEndLedgerIndex,
      ),
      activeProfileNonRegressing: activeAfterLedger >= activeBeforeLedger,
      catchUpComponentMeasured: true,
      g7NotOverstated: true,
    },
    verifiedAt: new Date().toISOString(),
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (request.headers.get(PURPOSE_HEADER) !== PURPOSE) {
    return json({ error: 'invalid_purpose' }, 403)
  }

  try {
    const body = object(await request.json(), 'request body')
    const runId = stringValue(body.runId, 'runId').toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(runId)) {
      return json({ error: 'invalid_run_id' }, 400)
    }
    return json(await execute(runId))
  } catch (error) {
    return json(
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      },
      500,
    )
  }
})
