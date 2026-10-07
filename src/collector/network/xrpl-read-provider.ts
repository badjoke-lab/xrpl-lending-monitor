import {
  XrplJsonRpcClient,
  XrplRpcError,
  type FetchLike,
} from './xrpl-rpc'

export interface XrplReadProvider {
  readonly kind: 'direct' | 'xrplto'
  readonly endpoint: string
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>
}

export class DirectXrplReadProvider implements XrplReadProvider {
  readonly kind = 'direct' as const
  readonly endpoint: string
  readonly client: XrplJsonRpcClient

  constructor(options: {
    endpoint: string
    timeoutMs: number
    fetcher?: FetchLike
  }) {
    this.endpoint = options.endpoint
    this.client = new XrplJsonRpcClient(options)
  }

  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.client.call<T>(method, params)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export class XrplToReadProvider implements XrplReadProvider {
  readonly kind = 'xrplto' as const
  readonly endpoint: string
  readonly timeoutMs: number
  readonly fetcher: FetchLike
  readonly apiKey: string | null
  readonly userAgent: string

  constructor(options: {
    endpoint: string
    timeoutMs: number
    apiKey?: string | null
    userAgent: string
    fetcher?: FetchLike
  }) {
    this.endpoint = options.endpoint
    this.timeoutMs = options.timeoutMs
    this.apiKey = options.apiKey?.trim() || null
    this.userAgent = options.userAgent.trim()
    if (this.userAgent.length === 0) {
      throw new Error('XRPL.to provider requires a descriptive User-Agent')
    }
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      let response: Response
      try {
        response = await this.fetcher(this.endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': this.userAgent,
            ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
          },
          body: JSON.stringify({ method, params }),
          signal: controller.signal,
        })
      } catch (error) {
        if (isAbortError(error)) {
          throw new XrplRpcError({
            endpoint: this.endpoint,
            method,
            code: 'timeout',
            message: `XRPL.to RPC timed out after ${this.timeoutMs} ms`,
            details: error,
          })
        }
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'network_error',
          message: error instanceof Error ? error.message : 'XRPL.to RPC network error',
          details: error,
        })
      }

      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after')
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: response.status === 429 ? 'rate_limited' : 'http_error',
          message:
            response.status === 429
              ? 'XRPL.to RPC rate limit reached'
              : `XRPL.to RPC returned HTTP ${response.status}`,
          details: {
            status: response.status,
            retryAfter,
          },
        })
      }

      let body: unknown
      try {
        body = await response.json()
      } catch (error) {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'invalid_json',
          message: 'XRPL.to RPC returned invalid JSON',
          details: error,
        })
      }

      if (!isRecord(body)) {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'invalid_response',
          message: 'XRPL.to RPC response was not an object',
          details: body,
        })
      }

      if (body.success !== true) {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: textValue(body.error) ?? 'provider_error',
          message:
            textValue(body.message) ??
            textValue(body.error) ??
            `XRPL.to RPC ${method} failed`,
          details: body,
        })
      }

      if (body.method !== method) {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'method_mismatch',
          message: `XRPL.to RPC method echo mismatch for ${method}`,
          details: body,
        })
      }

      if (!isRecord(body.result)) {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'invalid_response',
          message: 'XRPL.to RPC response did not include a result object',
          details: body,
        })
      }

      const result = body.result
      const errorCode = textValue(result.error)
      const status = textValue(result.status)
      if (errorCode || status === 'error') {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: errorCode ?? 'rpc_error',
          message:
            textValue(result.error_message) ??
            textValue(result.error_exception) ??
            `XRPL.to RPC ${method} failed`,
          details: result,
        })
      }

      return result as T
    } finally {
      clearTimeout(timeout)
    }
  }
}
