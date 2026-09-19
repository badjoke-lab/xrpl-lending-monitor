import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import {
  verifyDbLessBaseManifest,
  type DbLessBaseAssetDescriptorV1,
  type DbLessBaseManifestV1,
} from '../src/shared/db-less/base-manifest'
import { canonicalJson } from '../src/shared/current-state/canonical-json'

type VerificationCounts = {
  vaults: number
  loanBrokers: number
  loans: number
  lookupRecords: number
}

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function requiredArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function requiredArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative safe integer`)
  return Number(value)
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function verifyDescriptorFile(
  assetsDir: string,
  descriptor: DbLessBaseAssetDescriptorV1,
): Promise<Record<string, unknown>> {
  const path = join(assetsDir, descriptor.key)
  const info = await stat(path)
  if (info.size !== descriptor.bytes) throw new Error(`Asset byte mismatch: ${descriptor.key}`)
  if (await fileSha256(path) !== descriptor.sha256) throw new Error(`Asset digest mismatch: ${descriptor.key}`)

  const compressed = await readFile(path)
  const decoded = gunzipSync(compressed)
  const value = JSON.parse(decoded.toString('utf8')) as unknown
  return requiredRecord(value, descriptor.key)
}

function verifyVaultRecord(value: unknown): void {
  const vault = requiredRecord(value, 'vault record')
  requiredString(vault.id, 'vault.id')
}

function verifyBrokerRecord(value: unknown): void {
  const row = requiredRecord(value, 'loan-broker page record')
  const broker = requiredRecord(row.broker, 'loan-broker page record.broker')
  const vault = requiredRecord(row.vault, 'loan-broker page record.vault')
  const vaultId = requiredString(vault.id, 'embedded vault.id')
  if (requiredString(broker.vaultId, 'broker.vaultId') !== vaultId) {
    throw new Error('Embedded Broker -> Vault relationship mismatch')
  }
}

function verifyLoanRecord(value: unknown): void {
  const row = requiredRecord(value, 'loan page record')
  const loan = requiredRecord(row.loan, 'loan page record.loan')
  const broker = requiredRecord(row.broker, 'loan page record.broker')
  const vault = requiredRecord(row.vault, 'loan page record.vault')
  const brokerId = requiredString(broker.id, 'embedded broker.id')
  const vaultId = requiredString(vault.id, 'embedded vault.id')
  if (requiredString(loan.loanBrokerId, 'loan.loanBrokerId') !== brokerId) {
    throw new Error('Embedded Loan -> LoanBroker relationship mismatch')
  }
  if (requiredString(broker.vaultId, 'broker.vaultId') !== vaultId) {
    throw new Error('Embedded LoanBroker -> Vault relationship mismatch')
  }
}

function verifyPageEnvelope(
  descriptor: DbLessBaseAssetDescriptorV1,
  envelope: Record<string, unknown>,
): number {
  if (envelope.schemaVersion !== 1) throw new Error(`Invalid page schema: ${descriptor.key}`)
  if (requiredInteger(envelope.page, `${descriptor.key}.page`) !== descriptor.ordinal) {
    throw new Error(`Page ordinal mismatch: ${descriptor.key}`)
  }
  const records = requiredArray(envelope.records, `${descriptor.key}.records`)
  if (records.length !== descriptor.records) throw new Error(`Page record count mismatch: ${descriptor.key}`)

  if (descriptor.kind === 'vault-page') {
    if (envelope.kind !== 'vault') throw new Error(`Page kind mismatch: ${descriptor.key}`)
    records.forEach(verifyVaultRecord)
  } else if (descriptor.kind === 'loan-broker-page') {
    if (envelope.kind !== 'loan-broker') throw new Error(`Page kind mismatch: ${descriptor.key}`)
    records.forEach(verifyBrokerRecord)
  } else {
    if (envelope.kind !== 'loan') throw new Error(`Page kind mismatch: ${descriptor.key}`)
    records.forEach(verifyLoanRecord)
  }
  return records.length
}

function verifyLookupEnvelope(
  manifest: DbLessBaseManifestV1,
  descriptor: DbLessBaseAssetDescriptorV1,
  envelope: Record<string, unknown>,
): number {
  if (envelope.schemaVersion !== 1) throw new Error(`Invalid lookup schema: ${descriptor.key}`)
  const expectedPrefix = descriptor.ordinal
    .toString(16)
    .toUpperCase()
    .padStart(manifest.lookupPrefixLength, '0')
  if (envelope.prefix !== expectedPrefix) throw new Error(`Lookup prefix mismatch: ${descriptor.key}`)
  const records = requiredArray(envelope.records, `${descriptor.key}.records`)
  if (records.length !== descriptor.records) throw new Error(`Lookup record count mismatch: ${descriptor.key}`)

  for (const [index, value] of records.entries()) {
    const record = requiredRecord(value, `${descriptor.key}.records[${index}]`)
    const id = requiredString(record.id, 'lookup.id')
    if (!id.startsWith(expectedPrefix)) throw new Error(`Lookup record in wrong prefix bucket: ${descriptor.key}`)
    if (record.kind !== 'vault' && record.kind !== 'loan-broker' && record.kind !== 'loan') {
      throw new Error(`Lookup kind invalid: ${descriptor.key}`)
    }
    requiredInteger(record.page, 'lookup.page')
    requiredInteger(record.offset, 'lookup.offset')
  }
  return records.length
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const assetsDir = resolve(requiredArgument(args, '--assets-dir'))
  const outputPath = resolve(
    argumentValue(args, '--output')
      ?? join(assetsDir, '..', 'base-verification-summary.json'),
  )

  const manifestPath = join(assetsDir, 'base-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DbLessBaseManifestV1
  await verifyDbLessBaseManifest(manifest)

  const actualNames = (await readdir(assetsDir)).sort()
  const expectedNames = ['base-manifest.json', ...manifest.assets.map((asset) => asset.key)].sort()
  if (canonicalJson(actualNames) !== canonicalJson(expectedNames)) {
    throw new Error('Generated asset directory does not exactly match base manifest')
  }

  const counts: VerificationCounts = {
    vaults: 0,
    loanBrokers: 0,
    loans: 0,
    lookupRecords: 0,
  }
  let verifiedBytes = 0
  let largestAssetBytes = 0

  for (const descriptor of manifest.assets) {
    const envelope = await verifyDescriptorFile(assetsDir, descriptor)
    verifiedBytes += descriptor.bytes
    largestAssetBytes = Math.max(largestAssetBytes, descriptor.bytes)

    if (descriptor.kind === 'lookup') {
      counts.lookupRecords += verifyLookupEnvelope(manifest, descriptor, envelope)
      continue
    }

    const records = verifyPageEnvelope(descriptor, envelope)
    if (descriptor.kind === 'vault-page') counts.vaults += records
    else if (descriptor.kind === 'loan-broker-page') counts.loanBrokers += records
    else counts.loans += records
  }

  if (
    counts.vaults !== manifest.counts.vaults
    || counts.loanBrokers !== manifest.counts.loanBrokers
    || counts.loans !== manifest.counts.loans
  ) {
    throw new Error('Verified page counts do not match base manifest')
  }

  const totalObjects = counts.vaults + counts.loanBrokers + counts.loans
  if (counts.lookupRecords !== totalObjects) {
    throw new Error('Lookup records do not form one exact reference per Current object')
  }

  const summary = {
    schemaVersion: 1,
    generationId: manifest.generationId,
    snapshotId: manifest.snapshotId,
    ledgerIndex: manifest.ledgerIndex,
    ledgerHash: manifest.ledgerHash,
    manifestSha256: manifest.manifestSha256,
    releaseAssetCount: manifest.assets.length + 1,
    verifiedArtifactCount: manifest.assets.length,
    verifiedBytes,
    largestAssetBytes,
    counts,
    complete: true,
  }
  await writeFile(outputPath, `${canonicalJson(summary)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})