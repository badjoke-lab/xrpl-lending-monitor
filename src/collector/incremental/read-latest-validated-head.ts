import {
  XrplJsonRpcClient,
  failureFromError,
  type FetchLike,
  type RpcFailure,
} from '../network/xrpl-rpc'

const LEDGER_HASH = /^[A-F0-9]{64}$/

export interface LatestValidatedLedgerHead {
  endpoint: string
  ledgerIndex: number
  ledgerHash: string
  ageSeconds: number
}

interface ServerInfoResult {
  info?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return Number(value)
}

function requiredLedgerHash(value: unknown): string {
  if (typeof value !== 'string') throw new Error('validated ledger hash must be a string')
  const normalized = value.toUpperCase()
  if (!LEDGER_HASH.test(normalized)) {
    throw new Error('validated ledger hash must be a 64-character hexadecimal value')
  }
  return normalized
}

function parseHead(endpoint: string, result: ServerInfoResult): LatestValidatedLedgerHead {
  if (!isRecord(result.info)) throw new Error('server_info did not include info')
  if (!isRecord(result.info.validated_ledger)) {
    throw new Error('server_info did not include validated_ledger')
  }
  return {
    endpoint,
    ledgerIndex: requiredSafeInteger(result.info.validated_ledger.seq, 'validated_ledger.seq'),
    ledgerHash: requiredLedgerHash(result.info.validated_ledger.hash),
    ageSeconds: requiredSafeInteger(result.info.validated_ledger.age, 'validated_ledger.age'),
  }
}

export class LatestValidatedLedgerHeadError extends Error {
  readonly failures: readonly RpcFailure[]

  constructor(failures: readonly RpcFailure[]) {
    super('All configured XRPL endpoints failed the latest validated ledger read')
    this.name = 'LatestValidatedLedgerHeadError'
    this.failures = failures
  }
}

export async function readLatestValidatedLedgerHead(options: {
  endpoints: readonly string[]
  timeoutMs: number
  maxAgeSeconds?: number
  fetcher?: FetchLike
}): Promise<LatestValidatedLedgerHead> {
  if (options.endpoints.length === 0) throw new Error('At least one XRPL endpoint is required')
  if (
    options.maxAgeSeconds !== undefined
    && (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0)
  ) {
    throw new Error('maxAgeSeconds must be a non-negative safe integer')
  }
  const failures: RpcFailure[] = []

  for (const endpoint of options.endpoints) {
    try {
      const client = new XrplJsonRpcClient({
        endpoint,
        timeoutMs: options.timeoutMs,
        fetcher: options.fetcher,
      })
      const result = await client.call<ServerInfoResult>('server_info', { counters: false })
      const head = parseHead(endpoint, result)
      if (
        options.maxAgeSeconds !== undefined
        && head.ageSeconds > options.maxAgeSeconds
      ) {
        throw new Error(
          `validated ledger age ${head.ageSeconds}s exceeds ${options.maxAgeSeconds}s`,
        )
      }
      return head
    } catch (error) {
      const failure = failureFromError(error)
      failures.push({
        ...failure,
        endpoint: failure.endpoint === 'unknown' ? endpoint : failure.endpoint,
        method: failure.method === 'unknown' ? 'server_info' : failure.method,
      })
    }
  }

  throw new LatestValidatedLedgerHeadError(failures)
}
