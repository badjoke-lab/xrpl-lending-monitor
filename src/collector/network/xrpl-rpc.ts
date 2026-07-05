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

function usesNonStandardHttpsPort(endpoint: string): boolean {
  const url = new URL(endpoint)
  return url.protocol === 'https:' && url.port !== '' && url.port !== '443'
}

function decodeChunkedBody(body: string): string {
  let cursor = 0
  let decoded = ''

  while (cursor < body.length) {
    const lineEnd = body.indexOf('\r\n', cursor)
    if (lineEnd === -1) throw new Error('Malformed chunked HTTP response')

    const sizeToken = body.slice(cursor, lineEnd).split(';', 1)[0]
    const size = Number.parseInt(sizeToken, 16)
    if (!Number.isFinite(size)) throw new Error('Malformed chunk size in HTTP response')

    cursor = lineEnd + 2
    if (size === 0) break

    decoded += body.slice(cursor, cursor + size)
    cursor += size

    if (body.slice(cursor, cursor + 2) !== '\r\n') {
      throw new Error('Malformed chunk terminator in HTTP response')
    }
    cursor += 2
  }

  return decoded
}

async function readSocketResponse(readable: ReadableStream<Uint8Array>): Promise<Response> {
  const reader = readable.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalBytes += value.byteLength
  }

  const combined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  const raw = new TextDecoder().decode(combined)
  const headerEnd = raw.indexOf('\r\n\r\n')
  if (headerEnd === -1) throw new Error('XRPL socket response did not include HTTP headers')

  const headerLines = raw.slice(0, headerEnd).split('\r\n')
  const statusLine = headerLines.shift()
  const statusMatch = statusLine?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)
  if (!statusMatch) throw new Error('XRPL socket response had an invalid HTTP status line')

  const headers = new Headers()
  for (const line of headerLines) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }

  let responseBody = raw.slice(headerEnd + 4)
  if (headers.get('transfer-encoding')?.toLowerCase().includes('chunked')) {
    responseBody = decodeChunkedBody(responseBody)
  }

  return new Response(responseBody, {
    status: Number(statusMatch[1]),
    headers,
  })
}

async function socketFetch(endpoint: string, init: RequestInit): Promise<Response> {
  const url = new URL(endpoint)
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const body = typeof init.body === 'string' ? init.body : ''
  const { connect } = await import('cloudflare:sockets')
  const socket = connect(
    { hostname: url.hostname, port },
    { secureTransport: url.protocol === 'https:' ? 'on' : 'off' },
  )

  const path = `${url.pathname || '/'}${url.search}`
  const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname
  const request = [
    `${init.method ?? 'POST'} ${path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    'Content-Type: application/json',
    `Content-Length: ${new TextEncoder().encode(body).byteLength}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n')

  const writer = socket.writable.getWriter()
  try {
    await socket.opened
    await writer.write(new TextEncoder().encode(request))
    await writer.close()
    return await readSocketResponse(socket.readable)
  } finally {
    writer.releaseLock()
  }
}

export class XrplJsonRpcClient {
  readonly endpoint: string
  readonly timeoutMs: number
  readonly fetcher: FetchLike
  readonly hasCustomFetcher: boolean

  constructor(options: { endpoint: string; timeoutMs: number; fetcher?: FetchLike }) {
    this.endpoint = options.endpoint
    this.timeoutMs = options.timeoutMs
    this.fetcher = options.fetcher ?? fetch
    this.hasCustomFetcher = options.fetcher !== undefined
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        method,
        params: [{ ...params, api_version: 2 }],
      }),
      signal: controller.signal,
    }

    try {
      let response: Response
      try {
        response = await this.fetcher(this.endpoint, requestInit)
      } catch (fetchError) {
        if (this.hasCustomFetcher || !usesNonStandardHttpsPort(this.endpoint)) {
          throw fetchError
        }
        response = await socketFetch(this.endpoint, requestInit)
      }

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
