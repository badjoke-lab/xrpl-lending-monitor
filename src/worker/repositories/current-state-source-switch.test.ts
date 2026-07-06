import { describe, expect, it } from 'vitest'

import type { CurrentStateRuntimeConfig } from '../../shared/runtime-config'
import {
  assertCurrentStateSourceBinding,
  selectCurrentStateSource,
} from './current-state-source-switch'

const config: CurrentStateRuntimeConfig = {
  githubRepository: 'badjoke-lab/xrpl-lending-monitor',
  githubBranch: 'current-state-data',
  replacement: {
    snapshotId: 'devnet-3432924-canonical',
    githubBranch: 'current-state-candidate-data',
  },
  releaseChannelTag: 'current-state-channel',
  maxAssetBytes: 1024,
  maxDecompressedBytes: 2048,
}

describe('current-state source switching', () => {
  it('uses the primary branch before replacement-base rebase', () => {
    expect(selectCurrentStateSource({
      config,
      activeBaseSnapshotId: 'devnet-3371675-0ba2ed766c19',
    })).toEqual({
      githubBranch: 'current-state-data',
      activeBaseSnapshotId: 'devnet-3371675-0ba2ed766c19',
    })
  })

  it('switches to replacement branch only after D1 binds the replacement snapshot', () => {
    expect(selectCurrentStateSource({
      config,
      activeBaseSnapshotId: 'devnet-3432924-canonical',
    })).toEqual({
      githubBranch: 'current-state-candidate-data',
      activeBaseSnapshotId: 'devnet-3432924-canonical',
    })
  })

  it('fails closed when the opened manifest does not match D1 binding', () => {
    expect(() => assertCurrentStateSourceBinding({
      activeBaseSnapshotId: 'devnet-3432924-canonical',
      manifestSnapshotId: 'devnet-3371675-0ba2ed766c19',
    })).toThrow('does not match the active D1 overlay base')

    expect(() => assertCurrentStateSourceBinding({
      activeBaseSnapshotId: 'devnet-3432924-canonical',
      manifestSnapshotId: 'devnet-3432924-canonical',
    })).not.toThrow()
  })
})
