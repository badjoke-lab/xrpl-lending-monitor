import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { buildFastLaneShadowWindowPlan } from '../src/collector/incremental/fast-lane-shadow-plan'
import { readValidatedLedger } from '../src/collector/incremental/read-validated-ledger'
import { scanValidatedLedgerRange } from '../src/collector/incremental/scan-validated-ledgers'
import { commitFastLaneShadowWindow } from '../src/worker/repositories/fast-lane-shadow-repository'

interface Arguments {
  endpoint: string
  maxLedgers: number
  readWindow: number
  timeoutMs: number
  outputSql: string
  outputSummary: string
}

interface HeadIdentity {
  ledgerIndex: number
  ledgerHash: string
}

interface RecordedStatement {
  sql: string
  values: unknown[]
}

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function positiveInteger(value: string | null, fallback: number, field: string): number {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`)
  return parsed
}

function parseArguments(args: string[]): Arguments {
  return {
    endpoint: argumentValue(args, '--endpoint') ?? 'https://devnet.honeycluster.io/',
    maxLedgers: positiveInteger(argumentValue(args, '--max-ledgers'), 90, 'maxLedgers'),
    readWindow: positiveInteger(argumentValue(args, '--read-window'), 8, 'readWindow'),
    timeoutMs: positiveInteger(argumentValue(args, '--timeout-ms'), 8_000, 'timeoutMs'),
    outputSql: resolve(argumentValue(args, '--output-sql') ?? '/tmp/fast-lane-shadow-canary.sql'),
    outputSummary: resolve(argumentValue(args, '--output-summary') ?? '/tmp/fast-lane-shadow-canary-summary.json'),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function validatedHead(endpoint: string): Promise<HeadIdentity> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'ledger',
      params: [{ ledger_index: 'validated', transactions: false, expand: false }],
    }),
  })
  if (!response.ok) throw new Error(`Validated head request failed with HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (!isRecord(body) || !isRecord(body.result)) throw new Error('Validated head response did not contain result')
  const result = body.result
  if (result.validated !== true) throw new Error('Validated head response was not validated')
  const ledger = isRecord(result.ledger) ? result.ledger : null
  const indexValue = result.ledger_index ?? ledger?.ledger_index ?? ledger?.seqNum
  const hashValue = result.ledger_hash ?? ledger?.ledger_hash ?? ledger?.hash
  const ledgerIndex = typeof indexValue === 'string' && /^\d+$/.test(indexValue)
    ? Number(indexValue)
    : indexValue
  if (!Number.isSafeInteger(ledgerIndex) || Number(ledgerIndex) < 1) throw new Error('Validated head index is invalid')
  if (typeof hashValue !== 'string' || hashValue.length === 0) throw new Error('Validated head hash is invalid')
  return { ledgerIndex: Number(ledgerIndex), ledgerHash: hashValue }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize non-finite SQL number')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value !== 'string') throw new Error(`Unsupported SQL bind value type: ${typeof value}`)
  return `'${value.replaceAll("'", "''")}'`
}

function renderStatement(statement: RecordedStatement): string {
  return statement.sql.replace(/\?(\d+)/g, (_match, rawIndex: string) => {
    const bindIndex = Number(rawIndex) - 1
    if (!Number.isSafeInteger(bindIndex) || bindIndex < 0 || bindIndex >= statement.values.length) {
      throw new Error(`SQL placeholder ?${rawIndex} has no bound value`)
    }
    return sqlLiteral(statement.values[bindIndex])
  })
}

function recordingDatabase(options: {
  finalState: {
    epochId: string
    lastProcessedLedger: number
    lastProcessedHash: string
    latestObservedLedger: number
    latestObservedHash: string
    status: 'healthy' | 'behind'
    updatedAt: string
  }
}) {
  const statements: RecordedStatement[] = []
  const db = {
    prepare(sql: string) {
      const record: RecordedStatement = { sql, values: [] }
      const prepared = {
        bind(...values: unknown[]) {
          record.values = values
          return prepared
        },
        async first<T>() {
          if (!sql.includes('FROM fast_lane_shadow_state')) {
            throw new Error(`Unexpected recording first query: ${sql}`)
          }
          return {
            epoch_id: options.finalState.epochId,
            last_processed_ledger: options.finalState.lastProcessedLedger,
            last_processed_hash: options.finalState.lastProcessedHash,
            latest_observed_ledger: options.finalState.latestObservedLedger,
            latest_observed_hash: options.finalState.latestObservedHash,
            status: options.finalState.status,
            updated_at: options.finalState.updatedAt,
          } as T
        },
      }
      Object.defineProperty(prepared, '__record', { value: record })
      return prepared
    },
    async batch(prepared: Array<{ __record?: RecordedStatement }>) {
      statements.push(...prepared.map((item) => {
        if (!item.__record) throw new Error('Recording database received an unknown statement')
        return item.__record
      }))
      return prepared.map(() => ({ meta: { rows_read: 0, rows_written: 0 } }))
    },
  }
  return { db: db as unknown as D1Database, statements }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const processedAt = new Date().toISOString()
  const head = await validatedHead(args.endpoint)
  if (head.ledgerIndex <= args.maxLedgers) throw new Error('Validated head is too low for requested canary window')

  const startLedgerIndex = head.ledgerIndex - args.maxLedgers + 1
  const previous = await readValidatedLedger({
    endpoint: args.endpoint,
    ledgerIndex: startLedgerIndex - 1,
    timeoutMs: args.timeoutMs,
  })
  const scan = await scanValidatedLedgerRange({
    endpoint: args.endpoint,
    timeoutMs: args.timeoutMs,
    startLedgerIndex,
    latestValidatedLedger: head.ledgerIndex,
    maxLedgers: args.maxLedgers,
    expectedPreviousHash: previous.ledgerHash,
    readWindowSize: args.readWindow,
  })
  if (!scan.completeToLatest) throw new Error('Fast-lane canary scan did not reach the selected validated head')

  const plan = buildFastLaneShadowWindowPlan({
    epochId: 'fast-lane-shadow-devnet',
    scan,
    latestObservedHash: head.ledgerHash,
    processedAt,
  })
  const recording = recordingDatabase({
    finalState: {
      epochId: plan.epochId,
      lastProcessedLedger: plan.endLedgerIndex,
      lastProcessedHash: plan.endLedgerHash,
      latestObservedLedger: plan.latestObservedLedger,
      latestObservedHash: plan.latestObservedHash,
      status: plan.endLedgerIndex === plan.latestObservedLedger ? 'healthy' : 'behind',
      updatedAt: processedAt,
    },
  })

  await commitFastLaneShadowWindow({
    db: recording.db,
    plan,
    expectedPreviousLedger: previous.ledgerIndex,
    expectedPreviousHash: previous.ledgerHash,
    processedAt,
  })

  const sql = recording.statements.map(renderStatement).join(';\n\n') + ';\n'
  const summary = {
    schemaVersion: 1,
    mode: 'fast-lane-shadow-remote-write-canary',
    generatedAt: processedAt,
    source: {
      endpoint: args.endpoint,
      previousLedgerIndex: previous.ledgerIndex,
      previousLedgerHash: previous.ledgerHash,
      startLedgerIndex: plan.startLedgerIndex,
      endLedgerIndex: plan.endLedgerIndex,
      endLedgerHash: plan.endLedgerHash,
      latestObservedLedger: plan.latestObservedLedger,
      latestObservedHash: plan.latestObservedHash,
      ledgersRead: scan.metrics.ledgers,
      inspectedTransactions: plan.inspectedTransactions,
      lendingTransactions: plan.lendingTransactions,
      successfulLendingTransactions: plan.successfulLendingTransactions,
    },
    persistencePlan: {
      coalescedObjectRows: plan.mutations.length,
      bundledActivityRows: 1,
      activityEventsInBundle: plan.activity.length,
      preparedStatements: recording.statements.length,
    },
  }

  await mkdir(dirname(args.outputSql), { recursive: true })
  await mkdir(dirname(args.outputSummary), { recursive: true })
  await writeFile(args.outputSql, sql, 'utf8')
  await writeFile(args.outputSummary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
