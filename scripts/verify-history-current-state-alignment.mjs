#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

function requiredArg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`)
  }
  return process.argv[index + 1]
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const historyPath = requiredArg('--history-publication')
const channelPath = requiredArg('--history-channel')
const exactPath = requiredArg('--exact-index-manifest')
const currentPath = requiredArg('--current-manifest')
const historyRaw = await readFile(historyPath)
const channelRaw = await readFile(channelPath)
const exactRaw = await readFile(exactPath)
const currentRaw = await readFile(currentPath)
const history = JSON.parse(historyRaw)
const channel = JSON.parse(channelRaw)
const exact = JSON.parse(exactRaw)
const current = JSON.parse(currentRaw)
const historyFileSha256 = sha256(historyRaw)
const exactFileSha256 = sha256(exactRaw)

const failures = []
if (history.complete !== true) failures.push('history publication is incomplete')
if (current.complete !== true) failures.push('current-state manifest is incomplete')
if (history.epochId !== current.epochId) failures.push('history/current-state epoch mismatch')
if (history.endLedgerIndex !== current.ledgerIndex) failures.push('history/current-state ledger index mismatch')
if (String(history.endLedgerHash ?? '').toUpperCase() !== String(current.ledgerHash ?? '').toUpperCase()) {
  failures.push('history/current-state ledger hash mismatch')
}
if (channel.schemaVersion !== 1 || !channel.active) failures.push('history channel is invalid')
if (channel.active?.epochId !== history.epochId) failures.push('history channel epoch mismatch')
if (channel.active?.chainId !== history.chainId) failures.push('history channel chain mismatch')
if (channel.active?.publicationPath !== 'history/publication.json') failures.push('history channel publication path mismatch')
if (channel.active?.publicationSha256 !== historyFileSha256) failures.push('history channel publication file digest mismatch')
if (channel.active?.exactIndex?.manifestPath !== 'history/index/exact/manifest.json') failures.push('history channel exact-index path mismatch')
if (channel.active?.exactIndex?.manifestSha256 !== exactFileSha256) failures.push('history channel exact-index file digest mismatch')
if (exact.schemaVersion !== 2 || exact.network !== 'devnet') failures.push('history exact-index manifest is invalid')
if (exact.epochId !== history.epochId) failures.push('history exact-index epoch mismatch')
if (exact.chainId !== history.chainId) failures.push('history exact-index chain mismatch')
if (exact.publicationSha256 !== history.publicationSha256) failures.push('history exact-index logical publication digest mismatch')
if (!Number.isSafeInteger(exact.bucketCount) || exact.bucketCount < 1) failures.push('history exact-index bucket count is invalid')
if (!Number.isSafeInteger(exact.totalRecords) || exact.totalRecords < 1) failures.push('history exact-index record count is invalid')

const result = {
  passed: failures.length === 0,
  failures,
  history: {
    epochId: history.epochId ?? null,
    ledgerIndex: history.endLedgerIndex ?? null,
    ledgerHash: history.endLedgerHash ?? null,
    chainId: history.chainId ?? null,
    publicationSha256: history.publicationSha256 ?? null,
    fileSha256: historyFileSha256,
  },
  exactIndex: {
    manifestSha256: exact.manifestSha256 ?? null,
    fileSha256: exactFileSha256,
    publicationSha256: exact.publicationSha256 ?? null,
    bucketCount: exact.bucketCount ?? null,
    totalRecords: exact.totalRecords ?? null,
  },
  currentState: {
    epochId: current.epochId ?? null,
    ledgerIndex: current.ledgerIndex ?? null,
    ledgerHash: current.ledgerHash ?? null,
    snapshotId: current.snapshotId ?? null,
  },
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.passed) process.exit(1)
