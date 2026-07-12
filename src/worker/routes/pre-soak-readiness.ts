import { resolveReplacementBaseRuntimeConfig } from '../../shared/replacement-base-runtime-config'
import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import { reviewPreSoakRuntimeReadiness, type PreSoakHistoryEvidence } from '../operator/pre-soak-runtime-readiness'
import { rebaseToReplacementBase } from '../operator/replacement-base-rebase'
import { resolveHistorySource } from '../repositories/history-source'

const PATH = '/api/status/pre-soak-readiness'

export async function handlePreSoakReadiness(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PATH) return null
  if (request.method !== 'GET') {
    return Response.json({ error: 'method_not_allowed' }, {
      status: 405,
      headers: { allow: 'GET' },
    })
  }

  const runtimeConfig = resolveRuntimeConfig(env)
  const expectedBase = resolveReplacementBaseRuntimeConfig(env).target
  const source = await resolveHistorySource(runtimeConfig)
  let history: PreSoakHistoryEvidence
  if (source.kind === 'unavailable') {
    history = {
      status: 'unavailable',
      mode: 'hybrid',
      epochId: null,
      ledgerIndex: null,
      ledgerHash: null,
      exactIndexConfigured: false,
    }
  } else if (source.kind === 'd1') {
    history = {
      status: 'ok',
      mode: 'd1',
      epochId: null,
      ledgerIndex: null,
      ledgerHash: null,
      exactIndexConfigured: false,
    }
  } else {
    history = {
      status: 'ok',
      mode: 'hybrid',
      epochId: source.publication.epochId,
      ledgerIndex: source.publication.endLedgerIndex,
      ledgerHash: source.publication.endLedgerHash,
      exactIndexConfigured: source.exactIndex !== null,
    }
  }

  let replacementBaseDryRunPassed = false
  if (expectedBase) {
    try {
      const result = await rebaseToReplacementBase({
        db: env.DB,
        target: expectedBase,
        rebasedAt: new Date().toISOString(),
        dryRun: true,
      })
      replacementBaseDryRunPassed = result.status === 'replayed'
    } catch {
      replacementBaseDryRunPassed = false
    }
  }

  const report = await reviewPreSoakRuntimeReadiness({
    db: env.DB,
    network: env.APP_NETWORK,
    mainnetEnabled: env.MAINNET_ENABLED,
    expectedBase,
    history,
    replacementBaseDryRunPassed,
  })
  return Response.json(report)
}
