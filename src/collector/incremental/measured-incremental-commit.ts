import {
  commitIncrementalScan,
  type IncrementalCommitStatus,
} from '../../worker/repositories/incremental-ledger-repository'

export interface IncrementalPersistenceD1Usage {
  batchResults: number
  statements: number
  rowsRead: number
  rowsWritten: number
}

export const EMPTY_INCREMENTAL_PERSISTENCE_D1_USAGE: IncrementalPersistenceD1Usage = {
  batchResults: 0,
  statements: 0,
  rowsRead: 0,
  rowsWritten: 0,
}

function finiteMetric(meta: unknown, key: 'rows_read' | 'rows_written'): number {
  if (!meta || typeof meta !== 'object') return 0
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function summarizePersistenceBatch(options: {
  statements: number
  results: ReadonlyArray<{ meta?: unknown }>
}): IncrementalPersistenceD1Usage {
  return options.results.reduce<IncrementalPersistenceD1Usage>(
    (usage, result) => ({
      batchResults: usage.batchResults + 1,
      statements: usage.statements,
      rowsRead: usage.rowsRead + finiteMetric(result.meta, 'rows_read'),
      rowsWritten: usage.rowsWritten + finiteMetric(result.meta, 'rows_written'),
    }),
    {
      batchResults: 0,
      statements: options.statements,
      rowsRead: 0,
      rowsWritten: 0,
    },
  )
}

function withMeasuredPersistenceBatch(
  db: D1Database,
  onUsage: (usage: IncrementalPersistenceD1Usage) => void,
): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements)
          onUsage(summarizePersistenceBatch({ statements: statements.length, results }))
          return results
        }
      }

      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as D1Database
}

export async function commitIncrementalScanWithUsage(
  options: Parameters<typeof commitIncrementalScan>[0] & {
    onPersistenceUsage?: (usage: IncrementalPersistenceD1Usage) => void
  },
): Promise<IncrementalCommitStatus> {
  const { db, onPersistenceUsage, ...commitOptions } = options
  let usage = EMPTY_INCREMENTAL_PERSISTENCE_D1_USAGE
  const status = await commitIncrementalScan({
    ...commitOptions,
    db: withMeasuredPersistenceBatch(db, (measured) => {
      usage = measured
    }),
  })
  onPersistenceUsage?.(usage)
  return status
}
