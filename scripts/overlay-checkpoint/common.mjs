import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'

export const HASH = /^[A-F0-9]{64}$/
export const KINDS = new Set(['vault', 'loan-broker', 'loan'])
export const UINT32_SPACE = 0x1_0000_0000

export function arg(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function requiredArg(name) {
  const value = arg(name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

export function integerArg(name, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = arg(name, String(fallback))
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function canonicalValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON does not support non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => {
        if (entry === undefined) throw new Error(`Canonical JSON does not support undefined at ${key}`)
        return `${JSON.stringify(key)}:${canonicalValue(entry)}`
      })
    return `{${entries.join(',')}}`
  }
  throw new Error(`Canonical JSON does not support ${typeof value}`)
}

export function canonicalJson(value) {
  return canonicalValue(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function gzipDeterministic(value) {
  return gzipSync(Buffer.from(value), { level: 9, mtime: 0 })
}

export function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

export function text(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

export function integer(value, field, minimum = 0) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${field} must be an integer >= ${minimum}`)
  return Number(parsed)
}

export function hash(value, field) {
  const normalized = text(value, field).toUpperCase()
  if (!HASH.test(normalized)) throw new Error(`${field} must be a 64-character hash`)
  return normalized
}

export function kindForObjectType(value) {
  if (value === 'vault') return 'vault'
  if (value === 'loan_broker') return 'loan-broker'
  if (value === 'loan') return 'loan'
  throw new Error(`Unsupported overlay object type: ${String(value)}`)
}

export function projectionKind(kind) {
  return kind === 'loan-broker' ? 'loan_broker' : kind
}

export function emptyCounts() {
  return { vaults: 0, loanBrokers: 0, loans: 0 }
}

export function addKindCount(counts, kind) {
  if (kind === 'vault') counts.vaults += 1
  else if (kind === 'loan-broker') counts.loanBrokers += 1
  else counts.loans += 1
}

export function addCounts(target, source) {
  target.vaults += source.vaults
  target.loanBrokers += source.loanBrokers
  target.loans += source.loans
}

export function segmentForId(objectId, segmentCount) {
  const prefix = Number.parseInt(objectId.slice(0, 8), 16)
  return Math.min(segmentCount - 1, Math.floor(prefix * segmentCount / UINT32_SPACE))
}

export function nextHexPrefix(prefix) {
  const value = Number.parseInt(prefix, 16)
  const limit = 16 ** prefix.length
  if (value + 1 >= limit) return null
  return (value + 1).toString(16).toUpperCase().padStart(prefix.length, '0')
}

export async function d1Query(options, sql, params = []) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`
  let lastError = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(45_000),
      })
      const payload = await response.json()
      if (!response.ok || payload.success !== true) {
        const errors = [...(payload.errors ?? []), ...(payload.messages ?? [])]
          .map((entry) => entry.message)
          .filter(Boolean)
          .join('; ')
        throw new Error(`${response.status} ${errors || 'D1 query failed'}`)
      }
      const result = payload.result?.[0]
      if (!result || result.success === false) throw new Error('D1 query returned no successful result')
      return { rows: result.results ?? [], meta: result.meta ?? {} }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 500))
    }
  }
  throw lastError ?? new Error('D1 query failed')
}

export function createWorkDatabase(path) {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE objects (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      projection_json TEXT NOT NULL
    );
    CREATE INDEX objects_kind_id ON objects(kind, id);
    CREATE TABLE refs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      page_no INTEGER NOT NULL,
      offset_no INTEGER NOT NULL
    );
  `)
  return db
}

export function currentCounts(db) {
  const result = emptyCounts()
  for (const row of db.prepare('SELECT kind, COUNT(*) AS count FROM objects GROUP BY kind').all()) {
    if (row.kind === 'vault') result.vaults = Number(row.count)
    else if (row.kind === 'loan-broker') result.loanBrokers = Number(row.count)
    else if (row.kind === 'loan') result.loans = Number(row.count)
    else throw new Error(`Unknown object kind: ${String(row.kind)}`)
  }
  return result
}
