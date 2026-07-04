import type { Hono } from 'hono'

import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import {
  CurrentStateObjectReadError,
  listCurrentVaults,
} from '../repositories/current-state-object-reader'
import { openConfiguredReleaseCurrentState } from '../repositories/release-current-state'

function diagnosticMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown_error'
  return error.message.slice(0, 300)
}

async function probeKind(
  reader: NonNullable<Awaited<ReturnType<typeof openConfiguredReleaseCurrentState>>>['source']['opened']['reader'],
  kind: 'vault' | 'loan-broker' | 'loan',
) {
  const first = await reader.listObjects(kind, {
    limit: 2,
    direction: 'asc',
    maxAssetReads: 4,
  })
  const firstId = first.items[0]?.id ?? null
  const detail = firstId
    ? await reader.getObject(firstId, { maxAssetReads: 8 })
    : null
  const second = first.nextCursor
    ? await reader.listObjects(kind, {
        limit: 2,
        cursor: first.nextCursor,
        direction: 'asc',
        maxAssetReads: 4,
      })
    : null
  return {
    first_count: first.items.length,
    first_id: firstId,
    detail_found: detail?.item !== null,
    next_cursor: Boolean(first.nextCursor),
    second_count: second?.items.length ?? 0,
  }
}

async function probeInvalidCursor(
  opened: NonNullable<Awaited<ReturnType<typeof openConfiguredReleaseCurrentState>>>,
): Promise<string> {
  try {
    await listCurrentVaults(opened.source, opened.snapshot, {
      limit: 2,
      cursor: 'deadbeef',
      sort: 'id_asc',
    })
    return 'unexpected_success'
  } catch (error) {
    return error instanceof CurrentStateObjectReadError
      ? error.code
      : `unexpected:${diagnosticMessage(error)}`
  }
}

export function registerCurrentStateDiagnosticRoute(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/internal/current-state-diagnostic', async (context) => {
    const config = resolveRuntimeConfig(context.env)
    try {
      const opened = await openConfiguredReleaseCurrentState(config, context.env.DB)
      if (!opened) {
        return context.json({
          ok: false,
          stage: 'configuration',
          code: 'release_source_not_configured',
        })
      }
      const vaults = await probeKind(opened.source.opened.reader, 'vault')
      const loanBrokers = await probeKind(opened.source.opened.reader, 'loan-broker')
      const loans = await probeKind(opened.source.opened.reader, 'loan')
      const invalidCursor = await probeInvalidCursor(opened)
      return context.json({
        ok: true,
        stage: 'read_model_navigation',
        snapshot_id: opened.snapshot.id,
        ledger_index: opened.snapshot.ledgerIndex,
        counts: {
          vaults: opened.snapshot.vaultCount,
          loan_brokers: opened.snapshot.loanBrokerCount,
          loans: opened.snapshot.loanCount,
        },
        probes: {
          vaults,
          loan_brokers: loanBrokers,
          loans,
          invalid_cursor: invalidCursor,
        },
      })
    } catch (error) {
      return context.json({
        ok: false,
        stage: 'read_model_navigation',
        code: 'probe_failed',
        message: diagnosticMessage(error),
      })
    }
  })
}
