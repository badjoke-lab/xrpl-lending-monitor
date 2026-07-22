import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import {
  KINDS,
  addKindCount,
  canonicalJson,
  d1Query,
  emptyCounts,
  hash,
  integer,
  kindForObjectType,
  projectionKind,
  record,
  segmentForId,
  sha256,
  text,
} from './common.mjs'

export async function ingestRollingBase(db, baseDir) {
  const manifest = record(JSON.parse(await readFile(join(baseDir, 'manifest.json'), 'utf8')), 'rolling base manifest')
  if (manifest.schemaVersion !== 1 || manifest.network !== 'devnet' || manifest.complete !== true) {
    throw new Error('Rolling base manifest is incomplete or unsupported')
  }
  const epochId = text(manifest.epochId, 'manifest.epochId')
  const snapshotId = text(manifest.snapshotId, 'manifest.snapshotId')
  const ledgerIndex = integer(manifest.ledgerIndex, 'manifest.ledgerIndex', 1)
  const ledgerHash = hash(manifest.ledgerHash, 'manifest.ledgerHash')
  const assets = Array.isArray(manifest.assets) ? manifest.assets : []
  const segmentCount = integer(manifest.segmentCount, 'manifest.segmentCount', 1)
  if (assets.length !== segmentCount) throw new Error('Rolling base asset count mismatch')

  const expectedManifestDigest = sha256(`${canonicalJson({ ...manifest, manifestSha256: null })}\n`)
  if (manifest.manifestSha256 !== expectedManifestDigest) throw new Error('Rolling base manifest digest mismatch')

  const insert = db.prepare('INSERT INTO objects (id, kind, projection_json) VALUES (?, ?, ?)')
  const actual = emptyCounts()
  let batch = 0
  db.exec('BEGIN')
  try {
    for (const [index, rawAsset] of assets.entries()) {
      const asset = record(rawAsset, `assets[${index}]`)
      if (integer(asset.ordinal, `assets[${index}].ordinal`) !== index) throw new Error('Rolling base ordinals are not ordered')
      const compressed = await readFile(join(baseDir, text(asset.path, `assets[${index}].path`)))
      if (compressed.byteLength !== integer(asset.bytes, `assets[${index}].bytes`, 1) || sha256(compressed) !== asset.sha256) {
        throw new Error(`Rolling base asset integrity mismatch: ${asset.path}`)
      }
      const lines = gunzipSync(compressed).toString('utf8').split('\n').filter(Boolean)
      if (lines.length !== integer(asset.records, `assets[${index}].records`)) throw new Error(`Rolling base record count mismatch: ${asset.path}`)
      for (const line of lines) {
        const value = record(JSON.parse(line), 'rolling base record')
        if (value.schemaVersion !== 1) throw new Error('Rolling base record schema is unsupported')
        const kind = text(value.kind, 'record.kind')
        if (!KINDS.has(kind)) throw new Error(`Invalid rolling base kind: ${kind}`)
        const objectId = hash(value.id, 'record.id')
        if (segmentForId(objectId, segmentCount) !== index) throw new Error('Rolling base partition mismatch')
        const projection = record(value.projection, 'record.projection')
        if (hash(projection.id, 'projection.id') !== objectId || projection.kind !== projectionKind(kind)) {
          throw new Error(`Rolling base projection identity mismatch: ${objectId}`)
        }
        insert.run(objectId, kind, canonicalJson(projection))
        addKindCount(actual, kind)
        batch += 1
        if (batch >= 20_000) {
          db.exec('COMMIT')
          db.exec('BEGIN')
          batch = 0
        }
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const expectedCounts = record(manifest.counts, 'manifest.counts')
  if (canonicalJson(actual) !== canonicalJson(expectedCounts)) throw new Error('Rolling base aggregate counts mismatch')
  return { epochId, snapshotId, ledgerIndex, ledgerHash, segmentCount, counts: actual }
}

export async function readOverlayState(options, epochId) {
  const { rows } = await d1Query(options, `
    SELECT network, epoch_id, base_snapshot_id, base_ledger_index, base_ledger_hash,
           overlay_ledger_index, overlay_ledger_hash, updated_at
    FROM current_state_overlay_state
    WHERE network = 'devnet' AND epoch_id = ?1
    ORDER BY updated_at DESC, base_snapshot_id ASC
    LIMIT 1
  `, [epochId])
  const row = record(rows[0], 'current_state_overlay_state')
  if (row.network !== 'devnet' || row.epoch_id !== epochId) throw new Error('D1 overlay state identity mismatch')
  return {
    epochId,
    baseSnapshotId: text(row.base_snapshot_id, 'overlay.base_snapshot_id'),
    baseLedgerIndex: integer(row.base_ledger_index, 'overlay.base_ledger_index', 1),
    baseLedgerHash: hash(row.base_ledger_hash, 'overlay.base_ledger_hash'),
    overlayLedgerIndex: integer(row.overlay_ledger_index, 'overlay.overlay_ledger_index', 1),
    overlayLedgerHash: hash(row.overlay_ledger_hash, 'overlay.overlay_ledger_hash'),
    updatedAt: text(row.updated_at, 'overlay.updated_at'),
  }
}

export async function applyOverlayMutations(db, options, base, target, evidenceDir) {
  const upsert = db.prepare(`
    INSERT INTO objects (id, kind, projection_json) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, projection_json=excluded.projection_json
  `)
  const remove = db.prepare('DELETE FROM objects WHERE id = ?')
  const ndjsonPath = join(evidenceDir, 'overlay-mutations.ndjson')
  await writeFile(ndjsonPath, '')

  const stats = { fetched: 0, appliedUpserts: 0, appliedDeletes: 0, noOpDeletes: 0, pages: 0, rowsRead: 0 }
  let cursorLedger = base.ledgerIndex
  let cursorTransaction = -1
  let cursorObjectId = ''
  const pageSize = 1_000

  for (;;) {
    const { rows, meta } = await d1Query(options, `
      SELECT object_type, object_id, operation, projection_json,
             source_ledger_index, source_ledger_hash,
             source_transaction_hash, source_transaction_index
      FROM current_state_overlay_objects
      WHERE network = 'devnet'
        AND epoch_id = ?1
        AND base_snapshot_id = ?2
        AND source_ledger_index > ?3
        AND source_ledger_index <= ?4
        AND (
          source_ledger_index > ?5
          OR (source_ledger_index = ?5 AND source_transaction_index > ?6)
          OR (source_ledger_index = ?5 AND source_transaction_index = ?6 AND object_id > ?7)
        )
      ORDER BY source_ledger_index ASC, source_transaction_index ASC, object_id ASC
      LIMIT ?8
    `, [
      target.epochId,
      target.baseSnapshotId,
      base.ledgerIndex,
      target.overlayLedgerIndex,
      cursorLedger,
      cursorTransaction,
      cursorObjectId,
      pageSize,
    ])
    stats.pages += 1
    stats.rowsRead += Number(meta.rows_read ?? 0)
    if (rows.length === 0) break

    const evidenceLines = []
    db.exec('BEGIN')
    try {
      for (const rawRow of rows) {
        const row = record(rawRow, 'overlay mutation row')
        const ledgerIndex = integer(row.source_ledger_index, 'source_ledger_index', 1)
        const transactionIndex = integer(row.source_transaction_index, 'source_transaction_index')
        const objectId = hash(row.object_id, 'object_id')
        hash(row.source_ledger_hash, 'source_ledger_hash')
        hash(row.source_transaction_hash, 'source_transaction_hash')
        const kind = kindForObjectType(row.object_type)
        const operation = text(row.operation, 'operation')
        if (ledgerIndex <= base.ledgerIndex || ledgerIndex > target.overlayLedgerIndex) throw new Error('Overlay mutation is outside checkpoint bounds')

        if (operation === 'upsert') {
          const projectionText = text(row.projection_json, 'projection_json')
          const projection = record(JSON.parse(projectionText), 'projection')
          if (hash(projection.id, 'projection.id') !== objectId || projection.kind !== projectionKind(kind)) {
            throw new Error(`Overlay projection identity mismatch: ${objectId}`)
          }
          upsert.run(objectId, kind, canonicalJson(projection))
          stats.appliedUpserts += 1
        } else if (operation === 'deleted') {
          const result = remove.run(objectId)
          if (Number(result.changes) === 0) stats.noOpDeletes += 1
          else stats.appliedDeletes += 1
        } else {
          throw new Error(`Unsupported overlay operation: ${operation}`)
        }

        evidenceLines.push(canonicalJson({
          ledgerIndex,
          ledgerHash: row.source_ledger_hash,
          transactionHash: row.source_transaction_hash,
          transactionIndex,
          mutation: operation === 'upsert'
            ? { operation, objectType: row.object_type, objectId, projectionJson: canonicalJson(JSON.parse(row.projection_json)) }
            : { operation, objectType: row.object_type, objectId },
        }))
        stats.fetched += 1
        cursorLedger = ledgerIndex
        cursorTransaction = transactionIndex
        cursorObjectId = objectId
      }
      db.exec('COMMIT')
      if (evidenceLines.length > 0) await appendFile(ndjsonPath, `${evidenceLines.join('\n')}\n`)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    if (rows.length < pageSize) break
  }
  return stats
}
