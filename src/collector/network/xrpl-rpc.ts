export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export interface RpcFailure {
  endpoint: string
  method: string
  code: string
  message: string
}

export class XrplRpcError extends Error {
  readonly endpoint: string
  readonly method: string
  readonly code: string
  readonly details: unknown

  constructor(options: {
    endpoint: string
    method: string
    code: string
    message: string
    details?: unknown
  }) {
    super(options.message)
    this.name = 'XrplRpcError'
    this.endpoint = options.endpoint
    this.method = options.method
    this.code = options.code
    this.details = options.details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export class XrplJsonRpcClient {
  readonly endpoint: string
  readonly timeoutMs: number
  readonly fetcher: FetchLike

  constructor(options: { endpoint: string; timeoutMs: number; fetcher?: FetchLike }) {
    this.endpoint = options.endpoint
    this.timeoutMs = options.timeoutMs
    this.fetcher = options.fetcher ?? fetch
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          method,
          params: [{ ...params, api_version: 2 }],
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'http_error',
          message: `XRPL RPC returned HTTP ${response.status}`,
          details: { status: response.status },
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
          message: 'XRPL RPC returned invalid JSON',
          details: error,
        })
      }

      if (!isRecord(body) || !isRecord(body.result)) {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'invalid_response',
          message: 'XRPL RPC response did not include a result object',
          details: body,
        })
      }

      const result = body.result
      const errorCode = textValue(result.error) ?? textValue(body.error)
      const status = textValue(result.status) ?? textValue(body.status)

      if (errorCode || status === 'error') {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: errorCode ?? 'rpc_error',
          message:
            textValue(result.error_message) ??
            textValue(result.error_exception) ??
            `XRPL RPC ${method} failed`,
          details: result,
        })
      }

      return result as T
    } catch (error) {
      if (error instanceof XrplRpcError) throw error

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new XrplRpcError({
          endpoint: this.endpoint,
          method,
          code: 'timeout',
          message: `XRPL RPC timed out after ${this.timeoutMs} ms`,
          details: error,
        })
      }

      throw new XrplRpcError({
        endpoint: this.endpoint,
        method,
        code: 'network_error',
        message: error instanceof Error ? error.message : 'XRPL RPC network error',
        details: error,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function failureFromError(error: unknown): RpcFailure {
  if (error instanceof XrplRpcError) {
    return {
      endpoint: error.endpoint,
      method: error.method,
      code: error.code,
      message: error.message,
    }
  }

  return {
    endpoint: 'unknown',
    method: 'unknown',
    code: 'unknown_error',
    message: error instanceof Error ? error.message : String(error),
  }
}
