import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { buildFastLaneShadowWindowPlan } from '../src/collector/incremental/fast-lane-shadow-plan'
import { readValidatedLedger } from '../src/collector/incremental/read-validated-ledger'
import { scanValidatedLedgerRange } from '../src/collector/incremental/scan-validated-ledgers'

interface Arguments {
  endpoint: string
  startLedger: number
  endLedger: number
  epochId: string
  baseSnapshotId: string
  readWindow: number
  timeoutMs: number
  outputSql: string
  outputSummary: string
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

function requiredText(value: string | null, field: string): string {
  if (!value) throw new Error(`${field} is required`)
  return value
}

function parseArguments(args: string[]): Arguments {
  return {
    endpoint: argumentValue(args, '--endpoint') ?? 'https://s.devnet.rippletest.net:51234/',
    startLedger: positiveInteger(argumentValue(args, '--start-ledger'), 3_860_022, 'startLedger'),
    endLedger: positiveInteger(argumentValue(args, '--end-ledger'), 3_861_542, 'endLedger'),
    epochId: requiredText(argumentValue(args, '--epoch-id'), 'epochId'),
    baseSnapshotId: requiredText(argumentValue(args, '--base-snapshot-id'), 'baseSnapshotId'),
    readWindow: positiveInteger(argumentValue(args, '--read-window'), 8, 'readWindow'),
    timeoutMs: positiveInteger(argumentValue(args, '--timeout-ms'), 12_000, 'timeoutMs'),
    outputSql: resolve(argumentValue(args, '--output-sql') ?? '/tmp/current-state-overlay-gap-replay.sql'),
    outputSummary: resolve(argumentValue(args, '--output-summary') ?? '/tmp/current-state-overlay-gap-replay-summary.json'),
  }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize non-finite SQL number')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value !== 'string') throw new Error(`Unsupported SQL value type: ${typeof value}`)
  return `'${value.replaceAll("'", "''")}'`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function renderMutationInsert(options: {
  epochId: string
  baseSnapshotId: string
  entry: ReturnType<typeof buildFastLaneShadowWindowPlan>['mutations'][number]
}): string {
  const { entry } = options
  const links = entry.mutation.relationships ?? {}
  const projection = entry.mutation.operation === 'upsert' ? entry.mutation.projectionJson : null
  const values = [
    'devnet',
    options.epochId,
    options.baseSnapshotId,
    entry.mutation.objectType,
    entry.mutation.objectId,
    entry.mutation.operation,
    projection,
    links.owner ?? null,
    links.account ?? null,
    links.borrower ?? null,
    links.vaultId ?? null,
    links.loanBrokerId ?? null,
    links.assetKey ?? null,
    links.onLedgerStatus ?? null,
    entry.ledgerIndex,
    entry.ledgerHash,
    entry.transactionHash,
    entry.transactionIndex,
    entry.updatedAt,
  ].map(sqlLiteral).join(', ')

  return `INSERT INTO current_state_overlay_objects (
  network, epoch_id, base_snapshot_id, object_type, object_id, operation,
  projection_json, owner, account, borrower, vault_id, loan_broker_id,
  asset_key, on_ledger_status, source_ledger_index, source_ledger_hash,
  source_transaction_hash, source_transaction_index, updated_at
) VALUES (${values})
ON CONFLICT(network, epoch_id, base_snapshot_id, object_type, object_id)
DO UPDATE SET
  operation = excluded.operation,
  projection_json = excluded.projection_json,
  owner = excluded.owner,
  account = excluded.account,
  borrower = excluded.borrower,
  vault_id = excluded.vault_id,
  loan_broker_id = excluded.loan_broker_id,
  asset_key = excluded.asset_key,
  on_ledger_status = excluded.on_ledger_status,
  source_ledger_index = excluded.source_ledger_index,
  source_ledger_hash = excluded.source_ledger_hash,
  source_transaction_hash = excluded.source_transaction_hash,
  source_transaction_index = excluded.source_transaction_index,
  updated_at = excluded.updated_at
WHERE excluded.source_ledger_index > current_state_overlay_objects.source_ledger_index
   OR (
     excluded.source_ledger_index = current_state_overlay_objects.source_ledger_index
     AND excluded.source_transaction_index > current_state_overlay_objects.source_transaction_index
   );`
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  if (args.endLedger < args.startLedger) throw new Error('Replay end ledger is below start ledger')
  const ledgerCount = args.endLedger - args.startLedger + 1
  const generatedAt = new Date().toISOString()

  const previous = await readValidatedLedger({
    endpoint: args.endpoint,
    ledgerIndex: args.startLedger - 1,
    timeoutMs: args.timeoutMs,
  })
  const end = await readValidatedLedger({
    endpoint: args.endpoint,
    ledgerIndex: args.endLedger,
    timeoutMs: args.timeoutMs,
  })
  const scan = await scanValidatedLedgerRange({
    endpoint: args.endpoint,
    timeoutMs: args.timeoutMs,
    startLedgerIndex: args.startLedger,
    latestValidatedLedger: args.endLedger,
    maxLedgers: ledgerCount,
    expectedPreviousHash: previous.ledgerHash,
    readWindowSize: args.readWindow,
  })
  if (!scan.completeToLatest) throw new Error('Gap replay scan did not reach the exact end ledger')

  const plan = buildFastLaneShadowWindowPlan({
    epochId: 'gap-replay-devnet',
    scan,
    latestObservedHash: end.ledgerHash,
    processedAt: generatedAt,
  })
  if (plan.startLedgerIndex !== args.startLedger || plan.endLedgerIndex !== args.endLedger) {
    throw new Error('Gap replay plan does not match the requested range')
  }
  if (plan.endLedgerHash !== end.ledgerHash) throw new Error('Gap replay end-ledger identity mismatch')

  const missingVaultId = 'EE61076DFD544A725F7C7FB67908CFFF7E2B2BD78ECD23285F50E762A5D47143'
  const missingVault = plan.mutations.find((entry) => (
    entry.mutation.objectType === 'vault'
    && entry.mutation.objectId === missingVaultId
  ))
  if (!missingVault || missingVault.mutation.operation !== 'upsert' || missingVault.ledgerIndex !== 3_861_541) {
    throw new Error('Confirmed missing Vault mutation was not reconstructed at ledger 3861541')
  }

  const statements = plan.mutations.map((entry) => renderMutationInsert({
    epochId: args.epochId,
    baseSnapshotId: args.baseSnapshotId,
    entry,
  }))
  const sql = ['BEGIN TRANSACTION;', ...statements, 'COMMIT;'].join('\n\n') + '\n'
  const counts = plan.mutations.reduce<Record<string, number>>((result, entry) => {
    const key = `${entry.mutation.objectType}:${entry.mutation.operation}`
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
  const summary = {
    schemaVersion: 1,
    mode: 'bounded-current-state-overlay-gap-replay',
    generatedAt,
    target: {
      network: 'devnet',
      epochId: args.epochId,
      baseSnapshotId: args.baseSnapshotId,
    },
    source: {
      endpoint: args.endpoint,
      previousLedgerIndex: previous.ledgerIndex,
      previousLedgerHash: previous.ledgerHash,
      startLedgerIndex: plan.startLedgerIndex,
      endLedgerIndex: plan.endLedgerIndex,
      endLedgerHash: plan.endLedgerHash,
      ledgersRead: scan.metrics.ledgers,
      inspectedTransactions: plan.inspectedTransactions,
      lendingTransactions: plan.lendingTransactions,
      successfulLendingTransactions: plan.successfulLendingTransactions,
    },
    mutationCount: plan.mutations.length,
    mutationCounts: counts,
    affectedObjectIds: plan.mutations.map((entry) => ({
      objectType: entry.mutation.objectType,
      objectId: entry.mutation.objectId,
      operation: entry.mutation.operation,
      ledgerIndex: entry.ledgerIndex,
      transactionIndex: entry.transactionIndex,
    })),
    confirmedMissingVault: {
      objectId: missingVaultId,
      ledgerIndex: missingVault.ledgerIndex,
      transactionHash: missingVault.transactionHash,
      transactionIndex: missingVault.transactionIndex,
    },
    safeguards: {
      overlayWatermarkMutation: false,
      fastLaneCursorMutation: false,
      historyMutation: false,
      newerRowsProtectedBySourceOrder: true,
    },
    sqlSha256: sha256(sql),
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
