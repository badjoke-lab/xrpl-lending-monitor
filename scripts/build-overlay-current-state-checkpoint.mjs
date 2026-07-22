#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  arg,
  canonicalJson,
  createWorkDatabase,
  currentCounts,
  integerArg,
  requiredArg,
  sha256,
} from './overlay-checkpoint/common.mjs'
import { applyOverlayMutations, ingestRollingBase, readOverlayState } from './overlay-checkpoint/input.mjs'
import { writeKindPages, writeLookupBuckets, writeRollingBase } from './overlay-checkpoint/output.mjs'

async function main() {
  const baseDir = resolve(requiredArg('--base-dir'))
  const outputDir = resolve(requiredArg('--output-dir'))
  const evidenceDir = resolve(arg('--evidence-dir', join(outputDir, 'checkpoint-evidence')))
  const pageSize = integerArg('--page-size', 50, 1, 500)
  const lookupPrefixLength = integerArg('--lookup-prefix-length', 3, 1, 6)
  const rollingSegments = integerArg('--rolling-segments', 64, 1, 4096)
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
  const databaseId = process.env.D1_DATABASE_ID?.trim()
  if (!accountId || !apiToken || !databaseId) throw new Error('Cloudflare D1 credentials are required')
  const d1 = { accountId, apiToken, databaseId }

  await rm(outputDir, { recursive: true, force: true })
  await rm(evidenceDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  const workDir = resolve(`${outputDir}.work`)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  const db = createWorkDatabase(join(workDir, 'checkpoint.sqlite'))

  try {
    const base = await ingestRollingBase(db, baseDir)
    if (base.segmentCount !== rollingSegments) throw new Error('Requested rolling segment count differs from source base')
    const overlay = await readOverlayState(d1, base.epochId)
    if (base.ledgerIndex > overlay.overlayLedgerIndex) throw new Error('Source base is ahead of D1 overlay cursor')
    const snapshotId = `devnet-${overlay.overlayLedgerIndex}-${overlay.overlayLedgerHash.slice(0, 12).toLowerCase()}`
    const releaseTag = `replacement-current-state-${overlay.overlayLedgerIndex}`
    const target = { ...overlay, snapshotId, releaseTag }

    const mutationStats = await applyOverlayMutations(db, d1, base, target, evidenceDir)
    const counts = currentCounts(db)
    const vaultPages = await writeKindPages(db, outputDir, 'vault', pageSize)
    const brokerPages = await writeKindPages(db, outputDir, 'loan-broker', pageSize)
    const loanPages = await writeKindPages(db, outputDir, 'loan', pageSize)
    const lookupBuckets = await writeLookupBuckets(db, outputDir, lookupPrefixLength)

    const manifestWithoutDigest = {
      schemaVersion: 1,
      snapshotId,
      epochId: base.epochId,
      releaseTag,
      ledgerIndex: overlay.overlayLedgerIndex,
      ledgerHash: overlay.overlayLedgerHash,
      complete: true,
      pageSize,
      lookupPrefixLength,
      counts,
      pageCounts: { vaults: vaultPages, loanBrokers: brokerPages, loans: loanPages },
      manifestSha256: null,
    }
    const manifestSha256 = sha256(`${canonicalJson(manifestWithoutDigest)}\n`)
    const readModelManifest = { ...manifestWithoutDigest, manifestSha256 }
    await writeFile(join(outputDir, 'read-model', 'manifest.json'), `${canonicalJson(readModelManifest)}\n`)

    const rollingBase = await writeRollingBase(db, outputDir, {
      epochId: base.epochId,
      snapshotId,
      ledgerIndex: overlay.overlayLedgerIndex,
      ledgerHash: overlay.overlayLedgerHash,
    }, rollingSegments)
    if (canonicalJson(rollingBase.counts) !== canonicalJson(counts)) throw new Error('Rolling base counts differ from read model')

    const summary = {
      schemaVersion: 1,
      mode: 'd1-overlay-fold',
      source: base,
      overlaySource: overlay,
      target: {
        snapshotId,
        releaseTag,
        ledgerIndex: overlay.overlayLedgerIndex,
        ledgerHash: overlay.overlayLedgerHash,
        counts,
        pageCounts: readModelManifest.pageCounts,
        manifestSha256,
      },
      mutationStats,
      pageSize,
      lookupPrefixLength,
      lookupBuckets,
      rollingBase: {
        manifestSha256: rollingBase.manifestSha256,
        segmentCount: rollingBase.segmentCount,
        counts: rollingBase.counts,
      },
    }
    await writeFile(join(outputDir, 'rolling-read-model-summary.json'), `${canonicalJson(summary)}\n`)
    await writeFile(join(evidenceDir, 'checkpoint-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    db.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
