import type { RuntimeConfig } from '../../shared/runtime-config'

export function withReleaseCurrentState(config: RuntimeConfig): RuntimeConfig {
  return {
    ...config,
    currentState: {
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      maxAssetBytes: 8 * 1024 * 1024,
      maxDecompressedBytes: 16 * 1024 * 1024,
    },
  }
}
