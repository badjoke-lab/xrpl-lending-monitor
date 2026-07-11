import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Arguments {
  productionBase: string
  candidateBase: string
  witnesses: string
  output: string
}

type ObjectType = 'vault' | 'loan_broker' | 'loan'
type Operation = 'upsert' | 'deleted'

interface WitnessRow {
  object_type: ObjectType
  object_id: string
  operation: Operation
  projection_json: string | null
  source_ledger_index: number
  source_transaction_index: number
}

interface WranglerEnvelope {
  results?: WitnessRow[]
  success?: boolean
}

interface HttpResult {
  status: number
  body: unknown
}

interface WitnessEvidence {
  objectType: ObjectType
  objectId: string
  operation: Operation
  sourceLedgerIndex: number
  sourceTransactionIndex: number
  productionStatus: number
  candidateStatus: number
  comparison: 'created' | 'changed' | 'deleted' | 'unchanged' | 'unchanged_deleted'
  candidateVerified: boolean
  error: string | null
}

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function parseArguments(args: string[]): Arguments {
  const productionBase = argumentValue(args, '--production-base')
  const candidateBase = argumentValue(args, '--candidate-base')
  if (!productionBase || !candidateBase) {
    throw new Error('--production-base and --candidate-base are required')
  }
  return {
    productionBase: productionBase.replace(/\/$/, ''),
    candidateBase: candidateBase.replace(/\/$/, ''),
    witnesses: resolve(argumentValue(args, '--witnesses') ?? 'three-layer-canary-evidence/witnesses.json'),
    output: resolve(argumentValue(args, '--output') ?? 'three-layer-canary-evidence/summary.json'),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function fetchJson(url: string): Promise<HttpResult> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Request failed for ${url}: ${message}`)
  }
  const text = await response.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      throw new Error(`Non-JSON response from ${url}: HTTP ${response.status}`)
    }
  }
  return { status: response.status, body }
}

function detailPath(type: ObjectType, id: string): string {
  if (type === 'vault') return `/api/vaults/${id}`
  if (type === 'loan_broker') return `/api/loan-brokers/${id}`
  return `/api/loans/${id}`
}

function collectionPath(type: ObjectType): string {
  if (type === 'vault') return '/api/vaults'
  if (type === 'loan_broker') return '/api/loan-brokers'
  return '/api/loans'
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function projectionView(type: ObjectType, projection: Record<string, unknown>): Record<string, unknown> {
  if (type === 'vault') {
    return {
      id: projection.id,
      owner: projection.owner,
      account: projection.account,
      assets_total: projection.assetsTotal,
      assets_available: projection.assetsAvailable,
      assets_maximum: projection.assetsMaximum,
      loss_unrealized: projection.lossUnrealized,
      flags: projection.flags,
    }
  }
  if (type === 'loan_broker') {
    return {
      id: projection.id,
      vault_id: projection.vaultId,
      owner: projection.owner,
      account: projection.account,
      debt_total: projection.debtTotal,
      debt_maximum: projection.debtMaximum,
      cover_available: projection.coverAvailable,
      management_fee_rate: projection.managementFeeRate,
      flags: projection.flags,
    }
  }
  return {
    id: projection.id,
    loan_broker_id: projection.loanBrokerId,
    borrower: projection.borrower,
    payment_remaining: projection.paymentRemaining,
    principal_outstanding: projection.principalOutstanding,
    total_value_outstanding: projection.totalValueOutstanding,
    periodic_payment: projection.periodicPayment,
    on_ledger_status: projection.onLedgerStatus,
    flags: projection.flags,
  }
}

function apiView(type: ObjectType, body: unknown): Record<string, unknown> {
  const envelope = requiredRecord(body, 'detail response')
  const data = requiredRecord(envelope.data, 'detail response data')
  const view: Record<string, unknown> = {}
  for (const key of Object.keys(projectionView(type, {}))) view[key] = data[key]
  if (type === 'loan_broker') {
    const relatedVault = requiredRecord(data.related_vault, 'related_vault')
    view.related_vault_id = relatedVault.id
    view.expected_related_vault_id = data.vault_id
  }
  if (type === 'loan') {
    const relatedBroker = requiredRecord(data.related_loan_broker, 'related_loan_broker')
    const relatedVault = requiredRecord(data.related_vault, 'related_vault')
    view.related_loan_broker_id = relatedBroker.id
    view.expected_related_loan_broker_id = data.loan_broker_id
    view.related_vault_id = relatedVault.id
  }
  return view
}

function expectedApiView(type: ObjectType, projection: Record<string, unknown>): Record<string, unknown> {
  const view = projectionView(type, projection)
  if (type === 'loan_broker') {
    view.related_vault_id = projection.vaultId
    view.expected_related_vault_id = projection.vaultId
  }
  if (type === 'loan') {
    view.related_loan_broker_id = projection.loanBrokerId
    view.expected_related_loan_broker_id = projection.loanBrokerId
  }
  return view
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function stableDetailData(type: ObjectType, body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.data)) return body
  const data: Record<string, unknown> = { ...body.data }
  if (type === 'loan') {
    delete data.schedule_status
    delete data.default_eligible_ripple_time
    delete data.default_eligible_at
    if (isRecord(data.status_source)) {
      const source = { ...data.status_source }
      delete source.evaluated_at_ripple_time
      delete source.evaluated_at
      data.status_source = source
    }
  }
  return data
}

function sameStableDetail(type: ObjectType, left: unknown, right: unknown): boolean {
  return stableStringify(stableDetailData(type, left)) === stableStringify(stableDetailData(type, right))
}

async function verifyCollection(base: string, type: ObjectType): Promise<Record<string, unknown>> {
  const path = collectionPath(type)
  const first = await fetchJson(`${base}${path}?limit=25&sort=id_asc`)
  if (first.status !== 200) throw new Error(`${type} collection returned HTTP ${first.status}`)
  const envelope = requiredRecord(first.body, `${type} collection`)
  if (!Array.isArray(envelope.data)) throw new Error(`${type} collection data must be an array`)
  const ids = envelope.data.map((item, index) => {
    const record = requiredRecord(item, `${type} collection item ${index}`)
    if (typeof record.id !== 'string') throw new Error(`${type} collection item ${index} is missing id`)
    return record.id
  })
  if (new Set(ids).size !== ids.length) throw new Error(`${type} first page contains duplicate IDs`)
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index - 1]! >= ids[index]!) throw new Error(`${type} first page is not strictly ascending`)
  }

  const page = requiredRecord(envelope.page, `${type} collection page`)
  const nextCursor = page.next_cursor
  let secondCount = 0
  if (typeof nextCursor === 'string' && nextCursor.length > 0) {
    const second = await fetchJson(`${base}${path}?limit=25&sort=id_asc&cursor=${encodeURIComponent(nextCursor)}`)
    if (second.status !== 200) throw new Error(`${type} second page returned HTTP ${second.status}`)
    const secondEnvelope = requiredRecord(second.body, `${type} second collection`)
    if (!Array.isArray(secondEnvelope.data)) throw new Error(`${type} second page data must be an array`)
    const secondIds = secondEnvelope.data.map((item, index) => {
      const record = requiredRecord(item, `${type} second item ${index}`)
      if (typeof record.id !== 'string') throw new Error(`${type} second item ${index} is missing id`)
      return record.id
    })
    secondCount = secondIds.length
    const combined = [...ids, ...secondIds]
    if (new Set(combined).size !== combined.length) throw new Error(`${type} pagination contains duplicate IDs`)
    if (ids.length > 0 && secondIds.length > 0 && ids.at(-1)! >= secondIds[0]!) {
      throw new Error(`${type} pagination boundary is not strictly ascending`)
    }
  }

  return {
    firstPageCount: ids.length,
    secondPageCount: secondCount,
    hasNextCursor: typeof nextCursor === 'string' && nextCursor.length > 0,
  }
}

async function verifyWitness(options: {
  productionBase: string
  candidateBase: string
  witness: WitnessRow
}): Promise<WitnessEvidence> {
  const path = detailPath(options.witness.object_type, options.witness.object_id)
  const [production, candidate] = await Promise.all([
    fetchJson(`${options.productionBase}${path}`),
    fetchJson(`${options.candidateBase}${path}`),
  ])

  let candidateVerified = false
  let error: string | null = null
  try {
    if (options.witness.operation === 'deleted') {
      if (candidate.status !== 404) throw new Error(`candidate tombstone returned HTTP ${candidate.status}`)
      candidateVerified = true
    } else {
      if (candidate.status !== 200) throw new Error(`candidate upsert returned HTTP ${candidate.status}`)
      if (options.witness.projection_json === null) throw new Error('upsert witness projection is null')
      const projection = JSON.parse(options.witness.projection_json) as unknown
      const expected = expectedApiView(options.witness.object_type, requiredRecord(projection, 'witness projection'))
      const observed = apiView(options.witness.object_type, candidate.body)
      if (options.witness.object_type === 'loan') {
        delete observed.related_vault_id
      }
      if (stableStringify(expected) !== stableStringify(observed)) {
        throw new Error(`candidate semantic detail mismatch: expected=${stableStringify(expected)} observed=${stableStringify(observed)}`)
      }
      candidateVerified = true
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }

  let comparison: WitnessEvidence['comparison']
  if (options.witness.operation === 'deleted') {
    comparison = production.status === 200 ? 'deleted' : 'unchanged_deleted'
  } else if (production.status === 404 && candidate.status === 200) {
    comparison = 'created'
  } else if (production.status === 200 && candidate.status === 200) {
    comparison = sameStableDetail(options.witness.object_type, production.body, candidate.body)
      ? 'unchanged'
      : 'changed'
  } else {
    comparison = 'unchanged'
  }

  return {
    objectType: options.witness.object_type,
    objectId: options.witness.object_id,
    operation: options.witness.operation,
    sourceLedgerIndex: options.witness.source_ledger_index,
    sourceTransactionIndex: options.witness.source_transaction_index,
    productionStatus: production.status,
    candidateStatus: candidate.status,
    comparison,
    candidateVerified,
    error,
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const raw = JSON.parse(await readFile(args.witnesses, 'utf8')) as WranglerEnvelope[]
  if (raw[0]?.success !== true) throw new Error('witness D1 query did not succeed')
  const witnesses = raw[0]?.results ?? []
  if (witnesses.length === 0) throw new Error('three-layer witness set is empty')

  const [productionOverview, candidateOverview, vaultCollection, brokerCollection, loanCollection] = await Promise.all([
    fetchJson(`${args.productionBase}/api/overview`),
    fetchJson(`${args.candidateBase}/api/overview`),
    verifyCollection(args.candidateBase, 'vault'),
    verifyCollection(args.candidateBase, 'loan_broker'),
    verifyCollection(args.candidateBase, 'loan'),
  ])

  if (productionOverview.status !== 200) throw new Error(`production Overview returned HTTP ${productionOverview.status}`)
  if (candidateOverview.status !== 200) throw new Error(`candidate Overview returned HTTP ${candidateOverview.status}`)
  const overview = requiredRecord(candidateOverview.body, 'candidate Overview')
  const currentWatermark = requiredRecord(overview.current_state_watermark, 'current_state_watermark')
  const countsWatermark = requiredRecord(overview.counts_watermark, 'counts_watermark')
  const currentLedger = Number(currentWatermark.ledger_index)
  const countsLedger = Number(countsWatermark.ledger_index)
  if (!Number.isSafeInteger(currentLedger) || !Number.isSafeInteger(countsLedger)) {
    throw new Error('Overview watermarks contain invalid ledger indexes')
  }
  if (currentLedger < countsLedger) {
    throw new Error(`current-state watermark ${currentLedger} is behind counts watermark ${countsLedger}`)
  }
  if (!['fast_lane', 'canonical_overlay', 'base_snapshot'].includes(String(currentWatermark.source))) {
    throw new Error('Overview current-state watermark source is invalid')
  }

  const evidence: WitnessEvidence[] = []
  for (const witness of witnesses) {
    evidence.push(await verifyWitness({
      productionBase: args.productionBase,
      candidateBase: args.candidateBase,
      witness,
    }))
  }

  const candidateFailures = evidence.filter((item) => !item.candidateVerified)
  const comparisonCounts = evidence.reduce<Record<string, number>>((total, item) => {
    total[item.comparison] = (total[item.comparison] ?? 0) + 1
    return total
  }, {})
  const effectiveDifferences = (comparisonCounts.created ?? 0)
    + (comparisonCounts.changed ?? 0)
    + (comparisonCounts.deleted ?? 0)

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    passed: candidateFailures.length === 0 && effectiveDifferences > 0,
    productionBase: args.productionBase,
    candidateBase: args.candidateBase,
    overview: {
      production: productionOverview.body,
      candidate: candidateOverview.body,
    },
    collections: {
      vaults: vaultCollection,
      loanBrokers: brokerCollection,
      loans: loanCollection,
    },
    witnessCount: witnesses.length,
    candidateFailureCount: candidateFailures.length,
    effectiveDifferences,
    comparisonCounts,
    evidence,
  }

  await writeFile(args.output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (!summary.passed) process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
