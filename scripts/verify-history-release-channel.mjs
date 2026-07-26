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

const publicationPath = requiredArg('--history-publication')
const channelPath = requiredArg('--history-channel')
const exactPath = requiredArg('--exact-index-manifest')
const publicationRaw = await readFile(publicationPath)
const channelRaw = await readFile(channelPath)
const exactRaw = await readFile(exactPath)
const publication = JSON.parse(publicationRaw)
const channel = JSON.parse(channelRaw)
const exact = JSON.parse(exactRaw)
const publicationFileSha256 = sha256(publicationRaw)
const exactFileSha256 = sha256(exactRaw)

const failures = []
if (publication.schemaVersion !== 1 || publication.complete !== true || publication.network !== 'devnet') {
  failures.push('history publication is invalid')
}
if (channel.schemaVersion !== 1 || !channel.active) failures.push('history channel is invalid')
if (channel.active?.epochId !== publication.epochId) failures.push('history channel epoch mismatch')
if (channel.active?.chainId !== publication.chainId) failures.push('history channel chain mismatch')
if (channel.active?.publicationPath !== 'history/publication.json') failures.push('history channel publication path mismatch')
if (channel.active?.publicationSha256 !== publicationFileSha256) failures.push('history channel publication file digest mismatch')
if (channel.active?.exactIndex?.manifestPath !== 'history/index/exact/manifest.json') failures.push('history channel exact-index path mismatch')
if (channel.active?.exactIndex?.manifestSha256 !== exactFileSha256) failures.push('history channel exact-index file digest mismatch')
if (exact.schemaVersion !== 2 || exact.network !== 'devnet') failures.push('history exact-index manifest is invalid')
if (exact.epochId !== publication.epochId) failures.push('history exact-index epoch mismatch')
if (exact.chainId !== publication.chainId) failures.push('history exact-index chain mismatch')
if (exact.publicationSha256 !== publication.publicationSha256) failures.push('history exact-index logical publication digest mismatch')
if (!Number.isSafeInteger(exact.bucketCount) || exact.bucketCount < 1) failures.push('history exact-index bucket count is invalid')
if (!Number.isSafeInteger(exact.totalRecords) || exact.totalRecords < 1) failures.push('history exact-index record count is invalid')

const result = {
  passed: failures.length === 0,
  failures,
  publication: {
    epochId: publication.epochId ?? null,
    chainId: publication.chainId ?? null,
    ledgerIndex: publication.endLedgerIndex ?? null,
    ledgerHash: publication.endLedgerHash ?? null,
    publicationSha256: publication.publicationSha256 ?? null,
    fileSha256: publicationFileSha256,
  },
  exactIndex: {
    manifestSha256: exact.manifestSha256 ?? null,
    fileSha256: exactFileSha256,
    publicationSha256: exact.publicationSha256 ?? null,
    bucketCount: exact.bucketCount ?? null,
    totalRecords: exact.totalRecords ?? null,
  },
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.passed) process.exit(1)
