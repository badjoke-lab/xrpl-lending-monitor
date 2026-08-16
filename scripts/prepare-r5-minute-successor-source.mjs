#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const OLD_RUN_ID = 'r5-recovery-selected-revision4-entry'
const FAILED_RUN_ID = 'r5-recovery-selected-revision4-minute-entry'
const NEW_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'

const [path] = process.argv.slice(2)
if (!path) throw new Error('source path is required')

const source = await readFile(path, 'utf8')
const occurrences = source.split(OLD_RUN_ID).length - 1
if (occurrences !== 1) throw new Error(`expected exactly one formal revision4 run binding in ${path}, found ${occurrences}`)
if (source.includes(FAILED_RUN_ID)) throw new Error(`failed minute run id unexpectedly present in repository source ${path}`)
if (source.includes(NEW_RUN_ID)) throw new Error(`successor run id already present in repository source ${path}`)

const transformed = source.replace(OLD_RUN_ID, NEW_RUN_ID)
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex')
await writeFile(path, transformed, 'utf8')

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  purpose: 'r5-revision4-minute-successor-source-transform',
  path,
  oldRunId: OLD_RUN_ID,
  failedRunIdExcluded: FAILED_RUN_ID,
  newRunId: NEW_RUN_ID,
  replacementCount: occurrences,
  beforeSha256: sha256(source),
  afterSha256: sha256(transformed),
  mainnetDisabled: true,
})}\n`)
