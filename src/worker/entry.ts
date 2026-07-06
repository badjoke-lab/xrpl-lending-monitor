import { runIncrementalCollectorCycle } from '../collector/incremental/collector-cycle'
import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import { resolveCatchUpRuntimeConfig } from '../shared/catch-up-runtime-config'
import { GithubCurrentStateReadModelReader } from '../shared/current-state/github-read-model-reader'
import { resolveIncrementalRuntimeConfig } from '../shared/incremental-runtime-config'
import { resolveReplacementBaseRuntimeConfig } from '../shared/replacement-base-runtime-config'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import { app } from './index'
import { initializeCatchUpFromVerifiedBase } from './operator/catch-up-initialization'
import { diagnoseLiveContinuation, verifyLiveContinuation } from './operator/live-continuation-verification'
import { diagnoseM1RuntimeExit, reviewM1RuntimeExit } from './operator/m1-runtime-exit'
import { rebaseToReplacementBase } from './operator/replacement-base-rebase'
import { resolveHistorySource } from './repositories/history-source'
import { getIncrementalCollectorState } from './repositories/incremental-collector-state'
import { getSyncState } from './repositories/network-status-repository'
import { openConfiguredReleaseCurrentState } from './repositories/release-current-state'
import { handleHybridExactHistoryOverride } from './routes/hybrid-exact-history-override'
import { handleHybridHistoryOverride } from './routes/hybrid-history-override'
import { serializeCollectorStatus } from './serializers/collector-status'

const worker: ExportedHandler<Bindings> = {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/status/history-source') {
      const runtimeConfig = resolveRuntimeConfig(env)
      const history = await resolveHistorySource(runtimeConfig)
      if (history.kind === 'unavailable') return Response.json({ status: 'unavailable', mode: 'hybrid', configured: true, reason: history.unavailableReason }, { status: 503 })
      if (history.kind === 'd1') return Response.json({ status: 'ok', mode: 'd1', configured: false, chain: null, exact_index: null })
      return Response.json({
        status: 'ok', mode: 'hybrid', configured: true,
        channel: { updated_at: history.channel.updatedAt, data_commit_sha: history.channel.active.dataCommitSha },
        chain: {
          chain_id: history.publication.chainId, epoch_id: history.publication.epochId,
          start_ledger_index: history.publication.startLedgerIndex, end_ledger_index: history.publication.endLedgerIndex,
          segment_count: history.publication.segmentCount, ledger_count: history.publication.ledgerCount,
          publication_sha256: history.publication.publicationSha256,
        },
        exact_index: history.exactIndex ? {
          bucket_count: history.exactIndex.manifest.bucketCount,
          total_records: history.exactIndex.manifest.totalRecords,
          manifest_sha256: history.exactIndex.manifest.manifestSha256,
        } : null,
      })
    }
    if (request.method === 'GET' && url.pathname === '/api/status/collector') {
      const runtimeConfig = resolveRuntimeConfig(env)
      const [collector, sync] = await Promise.all([getIncrementalCollectorState(env.DB), getSyncState(env.DB)])
      return Response.json(serializeCollectorStatus({ collector, sync, staleAfterSeconds: runtimeConfig.staleAfterSeconds }))
    }
    if (request.method === 'GET' && url.pathname === '/api/status/continuation-verification') return Response.json(await verifyLiveContinuation(env.DB))
    if (request.method === 'GET' && url.pathname === '/api/status/continuation-diagnostics') return Response.json(await diagnoseLiveContinuation(env.DB))
    if (request.method === 'GET' && url.pathname === '/api/status/catch-up-initialization') {
      const runtimeConfig = resolveRuntimeConfig(env)
      const release = await openConfiguredReleaseCurrentState(runtimeConfig, env.DB)
      if (!release) return Response.json({ status: 'unavailable', reason: 'verified_base_release_unavailable' }, { status: 503 })
      const base = { epochId: release.snapshot.epochId, snapshotId: release.snapshot.id, ledgerIndex: release.snapshot.ledgerIndex, ledgerHash: release.snapshot.ledgerHash }
      const result = await initializeCatchUpFromVerifiedBase({ db: env.DB, base, initializedAt: new Date().toISOString(), dryRun: true })
      return Response.json({ base, ...result })
    }
    if (request.method === 'GET' && url.pathname === '/api/status/replacement-base-rebase') {
      const runtimeConfig = resolveRuntimeConfig(env)
      if (!runtimeConfig.currentState.githubRepository) {
        return Response.json({ status: 'unavailable', reason: 'current_state_repository_unconfigured' }, { status: 503 })
      }
      try {
        const candidate = await GithubCurrentStateReadModelReader.open({
          githubRepository: runtimeConfig.currentState.githubRepository,
          githubBranch: 'current-state-candidate-data',
        })
        const target = {
          epochId: candidate.manifest.epochId,
          snapshotId: candidate.manifest.snapshotId,
          ledgerIndex: candidate.manifest.ledgerIndex,
          ledgerHash: candidate.manifest.ledgerHash,
        }
        const result = await rebaseToReplacementBase({
          db: env.DB,
          target,
          rebasedAt: new Date().toISOString(),
          dryRun: true,
        })
        return Response.json({ target, ...result })
      } catch (error) {
        return Response.json({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'replacement_base_rebase_dry_run_failed',
        }, { status: 503 })
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/status/m1-exit') {
      const catchUpConfig = resolveCatchUpRuntimeConfig(env)
      return Response.json(await reviewM1RuntimeExit({ db: env.DB, expectedBase: catchUpConfig.base }))
    }
    if (request.method === 'GET' && url.pathname === '/api/status/m1-exit-diagnostics') {
      const catchUpConfig = resolveCatchUpRuntimeConfig(env)
      return Response.json(await diagnoseM1RuntimeExit({ db: env.DB, expectedBase: catchUpConfig.base }))
    }
    const hybridExactHistory = await handleHybridExactHistoryOverride(request, env)
    if (hybridExactHistory) return hybridExactHistory
    const hybridHistory = await handleHybridHistoryOverride(request, env)
    if (hybridHistory) return hybridHistory
    return app.fetch(request, env, executionContext)
  },
  async scheduled(_controller, env) {
    const runtimeConfig = resolveRuntimeConfig(env)
    await refreshNetworkStatus({ db: env.DB, config: runtimeConfig })
    const catchUpConfig = resolveCatchUpRuntimeConfig(env)
    if (catchUpConfig.initializationEnabled && catchUpConfig.base) {
      await initializeCatchUpFromVerifiedBase({ db: env.DB, base: catchUpConfig.base, initializedAt: new Date().toISOString() })
    }
    const replacementBaseConfig = resolveReplacementBaseRuntimeConfig(env)
    if (replacementBaseConfig.rebaseEnabled && replacementBaseConfig.target) {
      await rebaseToReplacementBase({
        db: env.DB,
        target: replacementBaseConfig.target,
        rebasedAt: new Date().toISOString(),
      })
    }
    await runIncrementalCollectorCycle({ db: env.DB, runtimeConfig, incrementalConfig: resolveIncrementalRuntimeConfig(env) })
  },
}

export default worker
