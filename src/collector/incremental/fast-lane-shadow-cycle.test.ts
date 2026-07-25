import { describe, expect, it } from 'vitest'

import { selectFastLaneHeadRpcEndpoint, selectFastLaneStartLedger } from './fast-lane-shadow-cycle'

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

describe('selectFastLaneStartLedger', () => {
  it('starts immediately after the canonical base when state is missing', () => {
    expect(selectFastLaneStartLedger({
      baseLedgerIndex: 3_860_021,
      lastProcessedLedger: null,
    })).toBe(3_860_022)
  })

  it('continues immediately after an existing cursor', () => {
    expect(selectFastLaneStartLedger({
      baseLedgerIndex: 3_860_021,
      lastProcessedLedger: 3_861_542,
    })).toBe(3_861_543)
  })

  it('rejects a cursor behind the canonical base', () => {
    expect(() => selectFastLaneStartLedger({
      baseLedgerIndex: 3_860_021,
      lastProcessedLedger: 3_860_020,
    })).toThrow('Fast-lane last processed ledger is invalid')
  })
})
