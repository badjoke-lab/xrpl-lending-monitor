#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

function requiredArg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`)
  }
  return process.argv[index + 1]
}

const historyPath = requiredArg('--history-publication')
const channelPath = requiredArg('--history-channel')
const exactPath = requiredArg('--exact-index-manifest')
const currentPath = requiredArg('--current-manifest')
const history = JSON.parse(await readFile(historyPath, 'utf8'))
const channel = JSON.parse(await readFile(channelPath, 'utf8'))
const exact = JSON.parse(await readFile(exactPath, 'utf8'))
const current = JSON.parse(await readFile(currentPath, 'utf8'))

const failures = []
if (history.complete !== true) failures.push('history publication is incomplete')
if (current.complete !== true) failures.push('current-state manifest is incomplete')
if (history.epochId !== current.epochId) failures.push('history/current-state epoch mismatch')
if (history.endLedgerIndex !== current.ledgerIndex) failures.push('history/current-state ledger index mismatch')
if (String(history.endLedgerHash ?? '').toUpperCase() !== String(current.ledgerHash ?? '').toUpperCase()) {
  failures.push('history/current-state ledger hash mismatch')
}
if (channel.schemaVersion !== 1 || !channel.active) failures.push('history channel is invalid')
if (channel.active?.publicationPath !== 'history/publication.json') failures.push('history channel publication path mismatch')
if (channel.active?.publicationSha256 !== history.publicationSha256) failures.push('history channel publication digest mismatch')
if (channel.active?.exactIndex?.manifestPath !== 'history/index/exact/manifest.json') failures.push('history channel exact-index path mismatch')
if (exact.schemaVersion !== 2 || exact.network !== 'devnet') failures.push('history exact-index manifest is invalid')
if (exact.epochId !== history.epochId) failures.push('history exact-index epoch mismatch')
if (exact.chainId !== history.chainId) failures.push('history exact-index chain mismatch')
if (exact.publicationSha256 !== history.publicationSha256) failures.push('history exact-index publication digest mismatch')
if (exact.manifestSha256 !== channel.active?.exactIndex?.manifestSha256) failures.push('history exact-index channel digest mismatch')
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
  },
  exactIndex: {
    manifestSha256: exact.manifestSha256 ?? null,
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
