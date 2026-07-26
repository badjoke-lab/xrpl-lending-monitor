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
const currentPath = requiredArg('--current-manifest')
const history = JSON.parse(await readFile(historyPath, 'utf8'))
const current = JSON.parse(await readFile(currentPath, 'utf8'))

const failures = []
if (history.complete !== true) failures.push('history publication is incomplete')
if (current.complete !== true) failures.push('current-state manifest is incomplete')
if (history.epochId !== current.epochId) failures.push('epoch mismatch')
if (history.endLedgerIndex !== current.ledgerIndex) failures.push('ledger index mismatch')
if (String(history.endLedgerHash ?? '').toUpperCase() !== String(current.ledgerHash ?? '').toUpperCase()) {
  failures.push('ledger hash mismatch')
}
if (!history.exactIndex || !history.exactIndex.manifestPath || !history.exactIndex.manifestSha256) {
  failures.push('history exact-index identity is missing')
}

const result = {
  passed: failures.length === 0,
  failures,
  history: {
    epochId: history.epochId ?? null,
    ledgerIndex: history.endLedgerIndex ?? null,
    ledgerHash: history.endLedgerHash ?? null,
    exactIndex: history.exactIndex ?? null,
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
