import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  UINT32_SPACE,
  addCounts,
  addKindCount,
  canonicalJson,
  emptyCounts,
  gzipDeterministic,
  hash,
  nextHexPrefix,
  segmentForId,
  sha256,
} from './common.mjs'

function withoutRaw(value) {
  const { raw: _raw, ...rest } = value
  return rest
}

async function writeGzipJson(path, value) {
  const compressed = gzipDeterministic(`${canonicalJson(value)}\n`)
  await writeFile(path, compressed)
  return compressed
}

export async function writeKindPages(db, outputDir, kind, pageSize) {
  const pageDir = join(outputDir, 'read-model', 'pages', kind)
  await mkdir(pageDir, { recursive: true })
  const query = db.prepare('SELECT id, projection_json FROM objects WHERE kind = ? ORDER BY id ASC')
  const byId = db.prepare('SELECT id, projection_json FROM objects WHERE id = ? AND kind = ?')
  const insertRef = db.prepare('INSERT INTO refs (id, kind, page_no, offset_no) VALUES (?, ?, ?, ?)')
  const records = []
  let pageNo = 0

  const requiredProjection = (idValue, requiredKind) => {
    const row = byId.get(idValue, requiredKind)
    if (!row) throw new Error(`Missing ${requiredKind} projection ${idValue}`)
    return JSON.parse(row.projection_json)
  }

  async function flush() {
    if (records.length === 0) return
    await writeGzipJson(join(pageDir, `${String(pageNo).padStart(8, '0')}.json.gz`), {
      schemaVersion: 1,
      kind,
      page: pageNo,
      records,
    })
    pageNo += 1
    records.length = 0
  }

  db.exec('BEGIN')
  try {
    for (const row of query.iterate(kind)) {
      const projection = JSON.parse(row.projection_json)
      let pageRecord
      if (kind === 'vault') pageRecord = projection
      else if (kind === 'loan-broker') {
        const vault = withoutRaw(requiredProjection(String(projection.vaultId), 'vault'))
        pageRecord = { broker: projection, vault }
      } else {
        const broker = requiredProjection(String(projection.loanBrokerId), 'loan-broker')
        const vault = withoutRaw(requiredProjection(String(broker.vaultId), 'vault'))
        pageRecord = { loan: projection, broker: withoutRaw(broker), vault }
      }
      const offset = records.length
      records.push(pageRecord)
      insertRef.run(row.id, kind, pageNo, offset)
      if (records.length >= pageSize) await flush()
    }
    await flush()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return pageNo
}

export async function writeLookupBuckets(db, outputDir, prefixLength) {
  const lookupDir = join(outputDir, 'read-model', 'lookup')
  await mkdir(lookupDir, { recursive: true })
  const query = db.prepare(`
    SELECT id, kind, page_no, offset_no FROM refs
    WHERE id >= ? AND (? IS NULL OR id < ?) ORDER BY id ASC
  `)
  const bucketCount = 16 ** prefixLength
  for (let index = 0; index < bucketCount; index += 1) {
    const prefix = index.toString(16).toUpperCase().padStart(prefixLength, '0')
    const next = nextHexPrefix(prefix)
    const rows = query.all(prefix, next, next)
    await writeGzipJson(join(lookupDir, `${prefix}.json.gz`), {
      schemaVersion: 1,
      prefix,
      records: rows.map((row) => ({ id: row.id, kind: row.kind, page: row.page_no, offset: row.offset_no })),
    })
  }
  return bucketCount
}

export async function writeRollingBase(db, outputDir, identity, segmentCount) {
  const baseDir = join(outputDir, 'rolling-base')
  await mkdir(baseDir, { recursive: true })
  const query = db.prepare('SELECT id, kind, projection_json FROM objects WHERE id >= ? AND (? IS NULL OR id < ?) ORDER BY id ASC')
  const assets = []
  const totalCounts = emptyCounts()

  for (let ordinal = 0; ordinal < segmentCount; ordinal += 1) {
    const startValue = Math.floor((ordinal * UINT32_SPACE) / segmentCount)
    const endValue = ordinal + 1 >= segmentCount ? null : Math.floor(((ordinal + 1) * UINT32_SPACE) / segmentCount)
    const start = startValue.toString(16).toUpperCase().padStart(8, '0')
    const end = endValue === null ? null : endValue.toString(16).toUpperCase().padStart(8, '0')
    const rows = query.all(start, end, end)
    const counts = emptyCounts()
    const records = rows.map((row) => {
      const objectId = hash(row.id, 'rolling output id')
      if (segmentForId(objectId, segmentCount) !== ordinal) throw new Error('Rolling output partition mismatch')
      addKindCount(counts, row.kind)
      return { schemaVersion: 1, id: objectId, kind: row.kind, projection: JSON.parse(row.projection_json) }
    })
    addCounts(totalCounts, counts)
    const textValue = records.length === 0 ? '' : `${records.map(canonicalJson).join('\n')}\n`
    const compressed = gzipDeterministic(textValue)
    const path = `segment-${String(ordinal).padStart(5, '0')}.ndjson.gz`
    await writeFile(join(baseDir, path), compressed)
    assets.push({
      path,
      ordinal,
      sha256: sha256(compressed),
      bytes: compressed.byteLength,
      records: records.length,
      firstObjectId: records[0]?.id ?? null,
      lastObjectId: records.at(-1)?.id ?? null,
      counts,
    })
  }

  const withoutDigest = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: identity.epochId,
    snapshotId: identity.snapshotId,
    ledgerIndex: identity.ledgerIndex,
    ledgerHash: identity.ledgerHash,
    complete: true,
    segmentCount,
    counts: totalCounts,
    assets,
  }
  const manifestSha256 = sha256(`${canonicalJson({ ...withoutDigest, manifestSha256: null })}\n`)
  const manifest = { ...withoutDigest, manifestSha256 }
  await writeFile(join(baseDir, 'manifest.json'), `${canonicalJson(manifest)}\n`)
  return manifest
}
