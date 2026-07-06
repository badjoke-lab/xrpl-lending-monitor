import type { RuntimeConfig } from '../../shared/runtime-config'
import {
  openGithubHistorySegmentChain,
  type HistorySegmentChannel,
} from '../../shared/history-segments/channel'
import type { HistorySegmentChainPublication } from '../../shared/history-segments/publication'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'

export type ResolvedHistorySource =
  | {
      kind: 'd1'
      configured: false
      reader: null
      channel: null
      publication: null
      unavailableReason: null
    }
  | {
      kind: 'hybrid'
      configured: true
      reader: HistorySegmentChainReader
      channel: HistorySegmentChannel
      publication: HistorySegmentChainPublication
      unavailableReason: null
    }
  | {
      kind: 'unavailable'
      configured: true
      reader: null
      channel: null
      publication: null
      unavailableReason: 'history_source_integrity_error'
    }

export async function resolveHistorySource(
  config: RuntimeConfig,
  options: { fetcher?: typeof fetch } = {},
): Promise<ResolvedHistorySource> {
  const repository = config.history.githubRepository
  if (!repository) {
    return {
      kind: 'd1',
      configured: false,
      reader: null,
      channel: null,
      publication: null,
      unavailableReason: null,
    }
  }

  try {
    const opened = await openGithubHistorySegmentChain({
      githubRepository: repository,
      githubBranch: config.history.githubBranch,
      channelPath: config.history.channelPath,
      maxAssetBytes: config.history.maxAssetBytes,
      timeoutMs: config.history.fetchTimeoutMs,
      fetcher: options.fetcher,
    })
    return {
      kind: 'hybrid',
      configured: true,
      reader: opened.reader,
      channel: opened.channel,
      publication: opened.publication,
      unavailableReason: null,
    }
  } catch {
    return {
      kind: 'unavailable',
      configured: true,
      reader: null,
      channel: null,
      publication: null,
      unavailableReason: 'history_source_integrity_error',
    }
  }
}
