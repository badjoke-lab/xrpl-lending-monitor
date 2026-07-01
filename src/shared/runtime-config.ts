export type AppNetwork = 'devnet'

export interface RuntimeEnvironment {
  APP_NETWORK?: string
  MAINNET_ENABLED?: string
  XRPL_DEVNET_RPC_URL?: string
}

export interface RuntimeConfig {
  network: AppNetwork
  mainnetEnabled: false
  xrplRpcUrl: string
}

export function resolveRuntimeConfig(env: RuntimeEnvironment): RuntimeConfig {
  if (env.APP_NETWORK !== 'devnet') {
    throw new Error('APP_NETWORK must remain devnet until Mainnet is explicitly approved')
  }

  if (env.MAINNET_ENABLED !== 'false') {
    throw new Error('MAINNET_ENABLED must remain false until Mainnet is explicitly approved')
  }

  if (!env.XRPL_DEVNET_RPC_URL) {
    throw new Error('XRPL_DEVNET_RPC_URL is required')
  }

  const rpcUrl = new URL(env.XRPL_DEVNET_RPC_URL)
  if (rpcUrl.protocol !== 'https:') {
    throw new Error('XRPL_DEVNET_RPC_URL must use HTTPS')
  }

  return {
    network: 'devnet',
    mainnetEnabled: false,
    xrplRpcUrl: rpcUrl.toString(),
  }
}
