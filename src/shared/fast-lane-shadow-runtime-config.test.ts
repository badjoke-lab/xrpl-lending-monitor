import { describe, expect, it } from 'vitest'

import { resolveFastLaneShadowRuntimeConfig } from './fast-lane-shadow-runtime-config'

describe('fast-lane shadow runtime config', () => {
  it('resolves bounded five-minute defaults', () => {
    expect(resolveFastLaneShadowRuntimeConfig({
      FAST_LANE_WEBSOCKET_ENDPOINT: 'wss://devnet.example/ws',
    })).toEqual({
      webSocketEndpoint: 'wss://devnet.example/ws',
      bootstrapLedgers: 90,
      maxLedgersPerRun: 180,
      reanchorLagLedgers: 720,
      readWindow: 8,
    })
  })

  it('allows a multi-run bootstrap window larger than one run', () => {
    expect(resolveFastLaneShadowRuntimeConfig({
      FAST_LANE_WEBSOCKET_ENDPOINT: 'wss://devnet.example/ws',
      FAST_LANE_BOOTSTRAP_LEDGERS: '720',
      FAST_LANE_MAX_LEDGERS_PER_RUN: '180',
      FAST_LANE_REANCHOR_LAG_LEDGERS: '720',
    })).toMatchObject({
      bootstrapLedgers: 720,
      maxLedgersPerRun: 180,
      reanchorLagLedgers: 720,
    })
  })

  it('rejects a bootstrap window larger than the reanchor bound', () => {
    expect(() => resolveFastLaneShadowRuntimeConfig({
      FAST_LANE_WEBSOCKET_ENDPOINT: 'wss://devnet.example/ws',
      FAST_LANE_BOOTSTRAP_LEDGERS: '721',
      FAST_LANE_MAX_LEDGERS_PER_RUN: '180',
      FAST_LANE_REANCHOR_LAG_LEDGERS: '720',
    })).toThrow('must be at least FAST_LANE_BOOTSTRAP_LEDGERS')
  })

  it('rejects non-WSS transport', () => {
    expect(() => resolveFastLaneShadowRuntimeConfig({
      FAST_LANE_WEBSOCKET_ENDPOINT: 'https://devnet.example',
    })).toThrow('must use WSS')
  })
})
