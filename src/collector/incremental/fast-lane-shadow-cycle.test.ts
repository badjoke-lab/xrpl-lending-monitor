import { describe, expect, it } from 'vitest'

import { selectFastLaneHeadRpcEndpoint } from './fast-lane-shadow-cycle'

describe('selectFastLaneHeadRpcEndpoint', () => {
  it('selects the HTTP endpoint on the same host as the ledger WebSocket', () => {
    expect(selectFastLaneHeadRpcEndpoint({
      rpcEndpoints: [
        'https://devnet.honeycluster.io/',
        'https://s.devnet.rippletest.net:51234/',
      ],
      webSocketEndpoint: 'wss://s.devnet.rippletest.net:51233/',
    })).toBe('https://s.devnet.rippletest.net:51234/')
  })

  it('falls back to the primary HTTP endpoint when no host matches', () => {
    expect(selectFastLaneHeadRpcEndpoint({
      rpcEndpoints: [
        'https://devnet.honeycluster.io/',
        'https://fallback.example/',
      ],
      webSocketEndpoint: 'wss://s.devnet.rippletest.net:51233/',
    })).toBe('https://devnet.honeycluster.io/')
  })

  it('rejects an empty RPC endpoint list', () => {
    expect(() => selectFastLaneHeadRpcEndpoint({
      rpcEndpoints: [],
      webSocketEndpoint: 'wss://s.devnet.rippletest.net:51233/',
    })).toThrow('Fast-lane shadow requires a Devnet RPC endpoint')
  })
})
