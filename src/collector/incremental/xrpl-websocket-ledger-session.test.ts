import { describe, expect, it, vi } from 'vitest'

import { resolveIncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../../shared/runtime-config'
import { XrplRpcError } from '../network/xrpl-rpc'
import { runPreparedIncrementalRange } from './run-prepared-range'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'
import {
  createXrplWebSocketLedgerSession,
  withXrplWebSocketLedgerSession,
  type WebSocketEventLike,
  type WebSocketEventListener,
  type XrplWebSocketLike,
} from './xrpl-websocket-ledger-session'

class FakeWebSocket implements XrplWebSocketLike {
  readyState = 0
  readonly sent: string[] = []
  closed = false
  private readonly listeners = new Map<string, Set<WebSocketEventListener>>()

  addEventListener(type: string, listener: WebSocketEventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WebSocketEventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: WebSocketEventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket is not open')
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = 3
  }

  emitOpen(): void {
    this.readyState = 1
    this.emit('open', {})
  }

  emitMessage(value: unknown): void {
    this.emit('message', { data: JSON.stringify(value) })
  }

  emitRawMessage(data: unknown): void {
    this.emit('message', { data })
  }

  emitError(): void {
    this.emit('error', {})
  }

  emitClose(): void {
    this.readyState = 3
    this.emit('close', {})
  }

  private emit(type: string, event: WebSocketEventLike): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sentRequest(socket: FakeWebSocket, position: number): Record<string, unknown> {
  const raw = socket.sent[position]
  if (!raw) throw new Error(`missing sent request ${position}`)
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value)) throw new Error('sent request was not an object')
  return value
}

function requestId(request: Record<string, unknown>): string {
  if (typeof request.id !== 'string') throw new Error('request id was not a string')
  return request.id
}

function ledgerResult(options: {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
}): Record<string, unknown> {
  return {
    validated: true,
    ledger_index: options.ledgerIndex,
    ledger_hash: options.ledgerHash,
    ledger: {
      parent_hash: options.parentHash,
      close_time: 1000 + options.ledgerIndex,
      transactions: [],
    },
  }
}

function successResponse(options: {
  id: string
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
}): Record<string, unknown> {
  return {
    id: options.id,
    status: 'success',
    type: 'response',
    result: ledgerResult(options),
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function createOpenedSession(socket: FakeWebSocket) {
  const session = createXrplWebSocketLedgerSession({
    endpoint: 'wss://devnet.example',
    webSocketFactory: () => socket,
  })
  socket.emitOpen()
  return session
}

describe('XRPL WebSocket ledger session', () => {
  it('correlates out-of-order responses to unique request ids', async () => {
    const socket = new FakeWebSocket()
    const session = createOpenedSession(socket)

    const first = session.reader({
      endpoint: 'https://ignored.example',
      ledgerIndex: 101,
      timeoutMs: 1000,
    })
    const second = session.reader({
      endpoint: 'https://ignored.example',
      ledgerIndex: 102,
      timeoutMs: 1000,
    })
    await flushMicrotasks()

    expect(socket.sent).toHaveLength(2)
    const firstRequest = sentRequest(socket, 0)
    const secondRequest = sentRequest(socket, 1)
    expect(firstRequest).toMatchObject({
      command: 'ledger',
      ledger_index: 101,
      transactions: true,
      expand: true,
      owner_funds: false,
      api_version: 2,
    })
    expect(requestId(firstRequest)).not.toBe(requestId(secondRequest))

    socket.emitMessage(successResponse({
      id: requestId(secondRequest),
      ledgerIndex: 102,
      ledgerHash: 'C'.repeat(64),
      parentHash: 'B'.repeat(64),
    }))
    socket.emitMessage(successResponse({
      id: requestId(firstRequest),
      ledgerIndex: 101,
      ledgerHash: 'B'.repeat(64),
      parentHash: 'A'.repeat(64),
    }))

    await expect(first).resolves.toMatchObject({ ledgerIndex: 101 })
    await expect(second).resolves.toMatchObject({ ledgerIndex: 102 })
    expect(session.usage).toEqual({
      connections: 1,
      logicalMessages: 2,
      successfulLedgers: 2,
    })

    session.close()
    expect(socket.closed).toBe(true)
  })

  it('fails closed when a response id does not match a pending request', async () => {
    const socket = new FakeWebSocket()
    const session = createOpenedSession(socket)
    const pending = session.reader({ endpoint: 'https://ignored.example', ledgerIndex: 201, timeoutMs: 1000 })
    await flushMicrotasks()

    socket.emitMessage(successResponse({
      id: 'ledger:unknown',
      ledgerIndex: 201,
      ledgerHash: 'B'.repeat(64),
      parentHash: 'A'.repeat(64),
    }))

    await expect(pending).rejects.toThrow('does not match a pending request')
    expect(socket.closed).toBe(true)
  })

  it('fails closed on malformed JSON', async () => {
    const socket = new FakeWebSocket()
    const session = createOpenedSession(socket)
    const pending = session.reader({ endpoint: 'https://ignored.example', ledgerIndex: 301, timeoutMs: 1000 })
    await flushMicrotasks()

    socket.emitRawMessage('{')

    await expect(pending).rejects.toThrow()
    expect(socket.closed).toBe(true)
  })

  it('surfaces XRPL error responses and closes the session', async () => {
    const socket = new FakeWebSocket()
    const session = createOpenedSession(socket)
    const pending = session.reader({ endpoint: 'https://ignored.example', ledgerIndex: 401, timeoutMs: 1000 })
    await flushMicrotasks()
    const id = requestId(sentRequest(socket, 0))

    socket.emitMessage({
      id,
      status: 'error',
      error: 'lgrNotFound',
      error_message: 'ledger not found',
    })

    await expect(pending).rejects.toMatchObject<XrplRpcError>({
      name: 'XrplRpcError',
      code: 'lgrNotFound',
      message: 'ledger not found',
    })
    expect(socket.closed).toBe(true)
  })

  it('rejects a wrong ledger index through the shared parser', async () => {
    const socket = new FakeWebSocket()
    const session = createOpenedSession(socket)
    const pending = session.reader({ endpoint: 'https://ignored.example', ledgerIndex: 501, timeoutMs: 1000 })
    await flushMicrotasks()
    const id = requestId(sentRequest(socket, 0))

    socket.emitMessage(successResponse({
      id,
      ledgerIndex: 502,
      ledgerHash: 'B'.repeat(64),
      parentHash: 'A'.repeat(64),
    }))

    await expect(pending).rejects.toThrow('Requested ledger 501 but received 502')
    expect(socket.closed).toBe(true)
  })

  it('times out a pending ledger request and closes the session', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeWebSocket()
      const session = createOpenedSession(socket)
      const pending = session.reader({ endpoint: 'https://ignored.example', ledgerIndex: 601, timeoutMs: 50 })
      await flushMicrotasks()

      await vi.advanceTimersByTimeAsync(51)

      await expect(pending).rejects.toThrow('timed out after 50 ms')
      expect(socket.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects pending work on connection error and unexpected close events', async () => {
    const errorSocket = new FakeWebSocket()
    const errorSession = createOpenedSession(errorSocket)
    const errorPending = errorSession.reader({ endpoint: 'https://ignored.example', ledgerIndex: 701, timeoutMs: 1000 })
    await flushMicrotasks()
    errorSocket.emitError()
    await expect(errorPending).rejects.toThrow('connection error')
    expect(errorSocket.closed).toBe(true)

    const closeSocket = new FakeWebSocket()
    const closeSession = createOpenedSession(closeSocket)
    const closePending = closeSession.reader({ endpoint: 'https://ignored.example', ledgerIndex: 702, timeoutMs: 1000 })
    await flushMicrotasks()
    closeSocket.emitClose()
    await expect(closePending).rejects.toThrow('closed unexpectedly')
  })

  it('closes the session in finally after both success and failure', async () => {
    const successSocket = new FakeWebSocket()
    await expect(withXrplWebSocketLedgerSession({
      endpoint: 'wss://devnet.example',
      webSocketFactory: () => successSocket,
      run: async () => 'ok',
    })).resolves.toBe('ok')
    expect(successSocket.closed).toBe(true)

    const failureSocket = new FakeWebSocket()
    await expect(withXrplWebSocketLedgerSession({
      endpoint: 'wss://devnet.example',
      webSocketFactory: () => failureSocket,
      run: async () => { throw new Error('persistence failed') },
    })).rejects.toThrow('persistence failed')
    expect(failureSocket.closed).toBe(true)
  })

  it('does not call commit after an incomplete WebSocket scan', async () => {
    const socket = new FakeWebSocket()
    const commit = vi.fn()
    const runtimeConfig = resolveRuntimeConfig({
      APP_NETWORK: 'devnet',
      MAINNET_ENABLED: 'false',
      XRPL_DEVNET_RPC_URL: 'https://devnet.example',
    })
    const run = withXrplWebSocketLedgerSession({
      endpoint: 'wss://devnet.example',
      webSocketFactory: () => socket,
      run: async (session) => runPreparedIncrementalRange({
        db: {} as D1Database,
        cursor: {
          epochId: 'epoch-1',
          lastProcessedLedger: 100,
          lastProcessedHash: 'A'.repeat(64),
          latestObservedLedger: 102,
          latestObservedHash: 'C'.repeat(64),
          endpoint: 'https://devnet.example',
        },
        scope: {
          epoch_id: 'epoch-1',
          base_snapshot_id: 'snapshot-1',
          base_ledger_index: 90,
          base_ledger_hash: '0'.repeat(64),
          overlay_ledger_index: 100,
          overlay_ledger_hash: 'A'.repeat(64),
        },
        previous: null,
        attemptedAt: '2026-07-10T00:00:00.000Z',
        startedAtMs: 0,
        runtimeConfig,
        incrementalConfig: resolveIncrementalRuntimeConfig({}),
        now: () => new Date(1),
        scan: (scanOptions) => scanValidatedLedgerRange({
          ...scanOptions,
          reader: session.reader,
        }),
        commit,
      }),
    })

    await flushMicrotasks()
    socket.emitOpen()
    await flushMicrotasks()
    const firstRequest = sentRequest(socket, 0)
    socket.emitMessage(successResponse({
      id: requestId(firstRequest),
      ledgerIndex: 101,
      ledgerHash: 'B'.repeat(64),
      parentHash: 'A'.repeat(64),
    }))
    await flushMicrotasks()
    expect(socket.sent).toHaveLength(2)

    socket.emitRawMessage('{')

    await expect(run).rejects.toThrow()
    expect(commit).not.toHaveBeenCalled()
    expect(socket.closed).toBe(true)
  })
})
