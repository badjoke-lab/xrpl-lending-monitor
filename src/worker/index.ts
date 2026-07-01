import { Hono } from 'hono'

import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/health', (context) => {
  const config = resolveRuntimeConfig(context.env)

  return context.json({
    ok: true,
    service: 'xrpl-lending-monitor',
    network: config.network,
    mainnet_enabled: config.mainnetEnabled,
  })
})

app.get('/api/status', (context) => {
  const config = resolveRuntimeConfig(context.env)

  return context.json({
    network: config.network,
    epoch: null,
    latest_validated_ledger: null,
    last_processed_ledger: null,
    last_synced_at: null,
    collector: {
      state: 'not_configured',
      message: 'Collector implementation begins in the next roadmap milestone.',
    },
  })
})

app.notFound((context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json(
      {
        error: 'not_found',
        path: context.req.path,
      },
      404,
    )
  }

  return context.env.ASSETS.fetch(context.req.raw)
})

export { app }
export default app
