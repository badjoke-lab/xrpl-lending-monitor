import {
  LENDING_PROTOCOL_ID,
  SINGLE_ASSET_VAULT_ID,
  type AmendmentStatus,
  type LendingAmendmentStatus,
} from '../../domain/network/amendments'
import {
  XrplJsonRpcClient,
  failureFromError,
  type FetchLike,
  type RpcFailure,
} from './xrpl-rpc'

interface ServerInfoResult {
  info?: unknown
}

interface ValidatedLedger {
  age: number
  hash: string
  seq: number
}

export interface NetworkSnapshot {
  network: 'devnet'
  observedAt: string
  endpoint: string
  serverVersion: string
  serverState: string | null
  completeLedgers: string | null
  validatedLedger: {
    ageSeconds: number
    hash: string
    index: number
  }
  amendments: LendingAmendmentStatus
}

export class NetworkSnapshotError extends Error {
  readonly failures: readonly RpcFailure[]

  constructor(failures: readonly RpcFailure[]) {
    super('All configured XRPL Devnet endpoints failed the network snapshot read')
    this.name = 'NetworkSnapshotError'
    this.failures = failures
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`XRPL response field ${field} must be a non-empty string`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requiredInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`XRPL response field ${field} must be a non-negative integer`)
  }
  return Number(value)
}

function parseValidatedLedger(value: unknown): ValidatedLedger {
  if (!isRecord(value)) {
    throw new Error('server_info did not include a validated_ledger object')
  }

  return {
    age: requiredInteger(value, 'age'),
    hash: requiredString(value, 'hash'),
    seq: requiredInteger(value, 'seq'),
  }
}

function parseServerInfo(result: ServerInfoResult): {
  version: string
  state: string | null
  completeLedgers: string | null
  ledger: ValidatedLedger
} {
  if (!isRecord(result.info)) {
    throw new Error('server_info did not include an info object')
  }

  return {
    version: requiredString(result.info, 'build_version'),
    state: optionalString(result.info, 'server_state'),
    completeLedgers: optionalString(result.info, 'complete_ledgers'),
    ledger: parseValidatedLedger(result.info.validated_ledger),
  }
}

function parseAmendment(
  result: Record<string, unknown>,
  expectedId: string,
  fallbackName: string,
): AmendmentStatus {
  const exact = result[expectedId]
  const candidates = exact
    ? [[expectedId, exact] as const]
    : Object.entries(result).filter(([, value]) => isRecord(value))

  for (const [id, value] of candidates) {
    if (!isRecord(value)) continue
    if (typeof value.enabled !== 'boolean' || typeof value.supported !== 'boolean') continue

    const name = typeof value.name === 'string' && value.name.length > 0 ? value.name : fallbackName
    if (id === expectedId || name === fallbackName) {
      return {
        id: expectedId,
        name,
        enabled: value.enabled,
        supported: value.supported,
      }
    }
  }

  throw new Error(`feature response did not include ${fallbackName}`)
}

async function readFromEndpoint(options: {
  endpoint: string
  timeoutMs: number
  fetcher?: FetchLike
  now: () => Date
}): Promise<NetworkSnapshot> {
  const client = new XrplJsonRpcClient({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    fetcher: options.fetcher,
  })

  const [serverInfoResult, lendingResult, vaultResult] = await Promise.all([
    client.call<ServerInfoResult>('server_info', { counters: false }),
    client.call<Record<string, unknown>>('feature', { feature: LENDING_PROTOCOL_ID }),
    client.call<Record<string, unknown>>('feature', { feature: SINGLE_ASSET_VAULT_ID }),
  ])

  const server = parseServerInfo(serverInfoResult)

  return {
    network: 'devnet',
    observedAt: options.now().toISOString(),
    endpoint: options.endpoint,
    serverVersion: server.version,
    serverState: server.state,
    completeLedgers: server.completeLedgers,
    validatedLedger: {
      ageSeconds: server.ledger.age,
      hash: server.ledger.hash,
      index: server.ledger.seq,
    },
    amendments: {
      lendingProtocol: parseAmendment(
        lendingResult,
        LENDING_PROTOCOL_ID,
        'LendingProtocol',
      ),
      singleAssetVault: parseAmendment(
        vaultResult,
        SINGLE_ASSET_VAULT_ID,
        'SingleAssetVault',
      ),
    },
  }
}

export async function readNetworkSnapshot(options: {
  endpoints: readonly string[]
  timeoutMs: number
  fetcher?: FetchLike
  now?: () => Date
}): Promise<NetworkSnapshot> {
  const failures: RpcFailure[] = []
  const now = options.now ?? (() => new Date())

  for (const endpoint of options.endpoints) {
    try {
      return await readFromEndpoint({
        endpoint,
        timeoutMs: options.timeoutMs,
        fetcher: options.fetcher,
        now,
      })
    } catch (error) {
      const failure = failureFromError(error)
      failures.push({
        ...failure,
        endpoint: failure.endpoint === 'unknown' ? endpoint : failure.endpoint,
        method: failure.method === 'unknown' ? 'network_snapshot' : failure.method,
      })
    }
  }

  throw new NetworkSnapshotError(failures)
}
