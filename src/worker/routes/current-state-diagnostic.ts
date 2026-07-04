import type { Hono } from 'hono'

import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import { openConfiguredReleaseCurrentState } from '../repositories/release-current-state'

function diagnosticMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown_error'
  return error.message.slice(0, 300)
}

export function registerCurrentStateDiagnosticRoute(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/internal/current-state-diagnostic', async (context) => {
    const config = resolveRuntimeConfig(context.env)
    try {
      const opened = await openConfiguredReleaseCurrentState(config)
      if (!opened) {
        return context.json({
          ok: false,
          stage: 'configuration',
          code: 'release_source_not_configured',
        })
      }
      return context.json({
        ok: true,
        stage: 'opened',
        snapshot_id: opened.snapshot.id,
        ledger_index: opened.snapshot.ledgerIndex,
        counts: {
          vaults: opened.snapshot.vaultCount,
          loan_brokers: opened.snapshot.loanBrokerCount,
          loans: opened.snapshot.loanCount,
        },
      })
    } catch (error) {
      return context.json({
        ok: false,
        stage: 'open_release_snapshot',
        code: 'open_failed',
        message: diagnosticMessage(error),
      })
    }
  })
}
