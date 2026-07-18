import { describe, expect, it, vi } from 'vitest'

import { XrplRpcError } from '../collector/network/xrpl-rpc'
import {
  isTransientFastLaneXrplError,
  withFastLaneTransientRetry,
} from './fast-lane-transient-retry'

describe('fast-lane transient retry', () => {
  it('classifies transient XRPL and WebSocket failures', () => {
    expect(isTransientFastLaneXrplError(new XrplRpcError({
      endpoint: 'wss://s.devnet.rippletest.net:51233/',
      method: 'ledger',
      code: 'ledgerNotFound',
      message: 'ledgerNotFound',
    }))).toBe(true)
    expect(isTransientFastLaneXrplError(new XrplRpcError({
      endpoint: 'https://s.devnet.rippletest.net:51234/',
      method: 'ledger',
      code: 'notSynced',
      message: 'notSynced',
    }))).toBe(true)
    expect(isTransientFastLaneXrplError(new Error('XRPL WebSocket connection closed unexpectedly')))
      .toBe(true)
    expect(isTransientFastLaneXrplError(new Error('fast-lane promotion base identity mismatch')))
      .toBe(false)
  })

  it('retries a transient failure in the same invocation', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new XrplRpcError({
        endpoint: 'wss://s.devnet.rippletest.net:51233/',
        method: 'ledger',
        code: 'ledgerNotFound',
        message: 'ledgerNotFound',
      }))
      .mockResolvedValueOnce('ok')
    const sleep = vi.fn(async () => undefined)
    const onRetry = vi.fn()

    await expect(withFastLaneTransientRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep,
      onRetry,
    })).resolves.toBe('ok')

    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(250)
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      nextAttempt: 2,
      maxAttempts: 3,
      delayMs: 250,
    }))
  })

  it('does not retry a permanent invariant failure', async () => {
    const failure = new Error('fast-lane promotion base identity mismatch')
    const operation = vi.fn().mockRejectedValue(failure)
    const sleep = vi.fn(async () => undefined)

    await expect(withFastLaneTransientRetry(operation, { sleep })).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('throws after the bounded attempt limit', async () => {
    const failure = new XrplRpcError({
      endpoint: 'wss://s.devnet.rippletest.net:51233/',
      method: 'ledger',
      code: 'timeout',
      message: 'timed out',
    })
    const operation = vi.fn().mockRejectedValue(failure)
    const sleep = vi.fn(async () => undefined)

    await expect(withFastLaneTransientRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 100,
      sleep,
    })).rejects.toBe(failure)

    expect(operation).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 100)
    expect(sleep).toHaveBeenNthCalledWith(2, 200)
  })
})
