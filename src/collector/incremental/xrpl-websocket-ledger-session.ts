import { XrplRpcError } from '../network/xrpl-rpc'
import { parseValidatedLedgerResult } from './read-validated-ledger'
import type { LedgerReader } from './scan-validated-ledgers'

export interface WebSocketEventLike {
  data?: unknown
}

export type WebSocketEventListener = (event: WebSocketEventLike) => void

export interface XrplWebSocketLike {
  readonly readyState: number
  addEventListener(type: string, listener: WebSocketEventListener): void
  removeEventListener(type: string, listener: WebSocketEventListener): void
  send(data: string): void
  close(): void
}

export type XrplWebSocketFactory = (endpoint: string) => XrplWebSocketLike

export interface XrplWebSocketLedgerUsage {
  connections: number
  logicalMessages: number
  successfulLedgers: number
}

export interface XrplWebSocketLedgerSession {
  reader: LedgerReader
  usage: XrplWebSocketLedgerUsage
  close(): void
}

interface PendingLedgerRequest {
  ledgerIndex: number
  resolve: (value: Awaited<ReturnType<LedgerReader>>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface OpenWaiter {
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function errorFrom(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

function defaultWebSocketFactory(endpoint: string): XrplWebSocketLike {
  return new WebSocket(endpoint) as unknown as XrplWebSocketLike
}

function assertWebSocketEndpoint(endpoint: string): void {
  const parsed = new URL(endpoint)
  if (parsed.protocol !== 'wss:') {
    throw new Error('XRPL WebSocket ledger endpoint must use wss://')
  }
}

export function createXrplWebSocketLedgerSession(options: {
  endpoint: string
  webSocketFactory?: XrplWebSocketFactory
}): XrplWebSocketLedgerSession {
  assertWebSocketEndpoint(options.endpoint)
  const socket = (options.webSocketFactory ?? defaultWebSocketFactory)(options.endpoint)
  const usage: XrplWebSocketLedgerUsage = {
    connections: 1,
    logicalMessages: 0,
    successfulLedgers: 0,
  }
  const pending = new Map<string, PendingLedgerRequest>()
  const openWaiters = new Set<OpenWaiter>()
  let nextRequestId = 0
  let open = socket.readyState === SOCKET_OPEN
  let closed = false
  let terminalError: Error | null = null

  const rejectOpenWaiters = (error: Error) => {
    for (const waiter of openWaiters) {
      clearTimeout(waiter.timeout)
      waiter.reject(error)
    }
    openWaiters.clear()
  }

  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    pending.clear()
  }

  const detachListeners = () => {
    socket.removeEventListener('open', onOpen)
    socket.removeEventListener('message', onMessage)
    socket.removeEventListener('error', onError)
    socket.removeEventListener('close', onClose)
  }

  const failSession = (error: Error, closeSocket: boolean) => {
    if (!terminalError) terminalError = error
    open = false
    closed = true
    rejectOpenWaiters(terminalError)
    rejectPending(terminalError)
    detachListeners()
    if (closeSocket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      socket.close()
    }
  }

  function onOpen(): void {
    if (closed) return
    open = true
    for (const waiter of openWaiters) {
      clearTimeout(waiter.timeout)
      waiter.resolve()
    }
    openWaiters.clear()
  }

  function onMessage(event: WebSocketEventLike): void {
    if (closed) return
    if (typeof event.data !== 'string') {
      failSession(new Error('XRPL WebSocket response must be a JSON string'), true)
      return
    }

    let body: unknown
    try {
      body = JSON.parse(event.data)
    } catch (error) {
      failSession(errorFrom(error, 'XRPL WebSocket returned malformed JSON'), true)
      return
    }

    if (!isRecord(body)) {
      failSession(new Error('XRPL WebSocket response must be an object'), true)
      return
    }

    const rawId = body.id
    if (typeof rawId !== 'string' && typeof rawId !== 'number') {
      failSession(new Error('XRPL WebSocket response did not include a request id'), true)
      return
    }
    const id = String(rawId)
    const request = pending.get(id)
    if (!request) {
      failSession(new Error(`XRPL WebSocket response id ${id} does not match a pending request`), true)
      return
    }

    pending.delete(id)
    clearTimeout(request.timeout)

    const result = body.result
    const resultRecord = isRecord(result) ? result : null
    const errorCode = textValue(body.error) ?? textValue(resultRecord?.error)
    const status = textValue(body.status) ?? textValue(resultRecord?.status)
    if (errorCode || status === 'error') {
      const error = new XrplRpcError({
        endpoint: options.endpoint,
        method: 'ledger',
        code: errorCode ?? 'rpc_error',
        message:
          textValue(body.error_message)
          ?? textValue(resultRecord?.error_message)
          ?? textValue(resultRecord?.error_exception)
          ?? 'XRPL WebSocket ledger request failed',
        details: resultRecord ?? body,
      })
      request.reject(error)
      failSession(error, true)
      return
    }

    if (!resultRecord) {
      const error = new Error('XRPL WebSocket response did not include a result object')
      request.reject(error)
      failSession(error, true)
      return
    }

    try {
      const ledger = parseValidatedLedgerResult({
        endpoint: options.endpoint,
        requestedLedgerIndex: request.ledgerIndex,
        result: resultRecord,
      })
      usage.successfulLedgers += 1
      request.resolve(ledger)
    } catch (error) {
      const failure = errorFrom(error, 'XRPL WebSocket ledger response parsing failed')
      request.reject(failure)
      failSession(failure, true)
    }
  }

  function onError(): void {
    if (closed) return
    failSession(new Error('XRPL WebSocket connection error'), true)
  }

  function onClose(): void {
    if (closed) return
    failSession(new Error('XRPL WebSocket connection closed unexpectedly'), false)
  }

  socket.addEventListener('open', onOpen)
  socket.addEventListener('message', onMessage)
  socket.addEventListener('error', onError)
  socket.addEventListener('close', onClose)

  const waitUntilOpen = async (timeoutMs: number): Promise<void> => {
    if (open) return
    if (terminalError) throw terminalError
    if (closed) throw new Error('XRPL WebSocket ledger session is closed')

    await new Promise<void>((resolve, reject) => {
      const waiter = {} as OpenWaiter
      waiter.resolve = resolve
      waiter.reject = reject
      waiter.timeout = setTimeout(() => {
        openWaiters.delete(waiter)
        const error = new Error(`XRPL WebSocket connection timed out after ${timeoutMs} ms`)
        reject(error)
        failSession(error, true)
      }, timeoutMs)
      openWaiters.add(waiter)
    })
  }

  const reader: LedgerReader = async (request) => {
    await waitUntilOpen(request.timeoutMs)
    if (terminalError) throw terminalError
    if (closed || socket.readyState !== SOCKET_OPEN) {
      throw new Error('XRPL WebSocket ledger session is not open')
    }

    const id = `ledger:${++nextRequestId}`
    usage.logicalMessages += 1

    return new Promise((resolve, reject) => {
      const pendingRequest = {} as PendingLedgerRequest
      pendingRequest.ledgerIndex = request.ledgerIndex
      pendingRequest.resolve = resolve
      pendingRequest.reject = reject
      pendingRequest.timeout = setTimeout(() => {
        pending.delete(id)
        const error = new Error(`XRPL WebSocket ledger ${request.ledgerIndex} timed out after ${request.timeoutMs} ms`)
        reject(error)
        failSession(error, true)
      }, request.timeoutMs)
      pending.set(id, pendingRequest)

      try {
        socket.send(JSON.stringify({
          id,
          command: 'ledger',
          ledger_index: request.ledgerIndex,
          transactions: true,
          expand: true,
          owner_funds: false,
          api_version: 2,
        }))
      } catch (error) {
        pending.delete(id)
        clearTimeout(pendingRequest.timeout)
        const failure = errorFrom(error, 'XRPL WebSocket send failed')
        reject(failure)
        failSession(failure, true)
      }
    })
  }

  const close = () => {
    if (closed) return
    closed = true
    open = false
    const error = new Error('XRPL WebSocket ledger session closed')
    if (!terminalError) terminalError = error
    rejectOpenWaiters(error)
    rejectPending(error)
    detachListeners()
    if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN) {
      socket.close()
    }
  }

  return { reader, usage, close }
}

export async function withXrplWebSocketLedgerSession<T>(options: {
  endpoint: string
  webSocketFactory?: XrplWebSocketFactory
  run: (session: XrplWebSocketLedgerSession) => Promise<T>
}): Promise<T> {
  const session = createXrplWebSocketLedgerSession(options)
  try {
    return await options.run(session)
  } finally {
    session.close()
  }
}
