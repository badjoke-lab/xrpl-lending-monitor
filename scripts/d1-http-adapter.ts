type JsonObject = Record<string, unknown>

type D1HttpParam = string | number | null

interface D1HttpQuery {
  sql: string
  params?: D1HttpParam[]
}

interface D1HttpMeta extends JsonObject {
  changes?: number
  duration?: number
  last_row_id?: number
  rows_read?: number
  rows_written?: number
}

interface D1HttpQueryResult {
  results?: JsonObject[]
  success?: boolean
  meta?: D1HttpMeta
}

interface D1HttpResponse {
  result?: D1HttpQueryResult[]
  success?: boolean
  errors?: Array<{ code?: number; message?: string }>
  messages?: Array<{ code?: number; message?: string }>
}

export interface D1HttpDatabaseOptions {
  accountId: string
  databaseId: string
  apiToken: string
  timeoutMs?: number
  maxAttempts?: number
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeParam(value: unknown): D1HttpParam {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  throw new Error(`Unsupported D1 HTTP parameter type: ${typeof value}`)
}

function apiError(response: D1HttpResponse): string {
  const messages = [
    ...(response.errors ?? []),
    ...(response.messages ?? []),
  ]
    .map((entry) => entry.message)
    .filter((message): message is string => Boolean(message))
  return messages.join('; ') || 'Cloudflare D1 HTTP query failed'
}

class D1HttpPreparedStatement {
  readonly sql: string
  readonly params: D1HttpParam[]

  constructor(
    private readonly database: D1HttpDatabase,
    sql: string,
    params: D1HttpParam[] = [],
  ) {
    this.sql = sql
    this.params = params
  }

  bind(...values: unknown[]): D1HttpPreparedStatement {
    return new D1HttpPreparedStatement(
      this.database,
      this.sql,
      values.map(normalizeParam),
    )
  }

  async first<T = JsonObject>(columnName?: string): Promise<T | null> {
    const result = await this.database.executeOne(this.toQuery())
    const first = result.results?.[0]
    if (!first) return null
    if (columnName !== undefined) {
      return (first[columnName] ?? null) as T | null
    }
    return first as T
  }

  async run<T = JsonObject>(): Promise<D1Result<T>> {
    return await this.database.executeOne(this.toQuery()) as D1Result<T>
  }

  async all<T = JsonObject>(): Promise<D1Result<T>> {
    return await this.database.executeOne(this.toQuery()) as D1Result<T>
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.database.executeOne(this.toQuery())
    const rows = result.results ?? []
    const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : []
    const values = rows.map((row) => columns.map((column) => row[column]))
    return (options?.columnNames ? [columns, ...values] : values) as T[]
  }

  toQuery(): D1HttpQuery {
    return this.params.length > 0
      ? { sql: this.sql, params: this.params }
      : { sql: this.sql }
  }
}

class D1HttpDatabase {
  private readonly endpoint: string
  private readonly timeoutMs: number
  private readonly maxAttempts: number

  constructor(private readonly options: D1HttpDatabaseOptions) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxAttempts = options.maxAttempts ?? 3
  }

  prepare(sql: string): D1HttpPreparedStatement {
    return new D1HttpPreparedStatement(this, sql)
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const queries = statements.map((statement) => {
      if (!(statement instanceof D1HttpPreparedStatement)) {
        throw new Error('D1 HTTP batch received a foreign prepared statement')
      }
      return statement.toQuery()
    })
    return await this.executeBatch(queries) as D1Result[]
  }

  async exec(sql: string): Promise<D1ExecResult> {
    const results = await this.executeBatch([{ sql }])
    const count = results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0)
    const duration = results.reduce((sum, result) => sum + (result.meta?.duration ?? 0), 0)
    return { count, duration }
  }

  async executeOne(query: D1HttpQuery): Promise<D1HttpQueryResult> {
    const results = await this.executeBatch([query])
    const result = results[0]
    if (!result) throw new Error('Cloudflare D1 HTTP query returned no result')
    return result
  }

  private async executeBatch(queries: D1HttpQuery[]): Promise<D1HttpQueryResult[]> {
    const body = queries.length === 1 ? queries[0] : { batch: queries }
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        const payload = await response.json() as D1HttpResponse
        if (!response.ok || payload.success !== true) {
          throw new Error(`${response.status} ${apiError(payload)}`)
        }
        const results = payload.result ?? []
        const failed = results.find((result) => result.success === false)
        if (failed) throw new Error('Cloudflare D1 HTTP statement failed')
        return results
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < this.maxAttempts) await delay(250 * attempt)
      }
    }

    throw lastError ?? new Error('Cloudflare D1 HTTP query failed')
  }
}

export function createD1HttpDatabase(options: D1HttpDatabaseOptions): D1Database {
  return new D1HttpDatabase(options) as unknown as D1Database
}
