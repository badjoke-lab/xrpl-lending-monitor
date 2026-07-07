import { expect, test } from 'vitest'

import { openGithubHistorySegmentChain } from './channel'

test('opens the configured public history source with production values', async () => {
  let caught: unknown

  try {
    const opened = await openGithubHistorySegmentChain({
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'history-data',
      channelPath: 'history-channel.json',
      maxAssetBytes: 33_554_432,
      timeoutMs: 8_000,
    })

    console.log('PUBLIC_HISTORY_SOURCE_PROBE_OK', JSON.stringify({
      channelCommit: opened.channel.active.dataCommitSha,
      chainId: opened.publication.chainId,
      startLedgerIndex: opened.publication.startLedgerIndex,
      endLedgerIndex: opened.publication.endLedgerIndex,
      segmentCount: opened.publication.segmentCount,
      exactIndexRecords: opened.exactIndex?.manifest.totalRecords ?? null,
    }))
  } catch (error) {
    caught = error
    console.error('PUBLIC_HISTORY_SOURCE_PROBE_ERROR', error instanceof Error
      ? JSON.stringify({ name: error.name, message: error.message, stack: error.stack })
      : String(error))
  }

  expect(caught).toBeUndefined()
}, 120_000)
