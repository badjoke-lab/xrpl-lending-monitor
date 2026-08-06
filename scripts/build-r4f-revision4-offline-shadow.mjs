import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { runSupabaseRevision4OfflineShadow } from '../src/shared/supabase-revision4-offline-shadow.ts'

const fixturePath =
  process.env.R4F_G2C_FIXTURE ?? 'ops/r4f/revision4-offline-shadow-fixture.json'
const outputDirectory =
  process.env.R4F_G2C_OUTPUT ?? 'r4f-revision4-offline-shadow-evidence'

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
const result = await runSupabaseRevision4OfflineShadow(fixture)

await mkdir(outputDirectory, { recursive: true })
await writeFile(
  `${outputDirectory}/evidence.json`,
  `${JSON.stringify(result, null, 2)}\n`,
)
await writeFile(
  `${outputDirectory}/persistence-rpc-request.json`,
  `${result.persistenceRpcRequestBody}\n`,
)

const accounting = result.accountingEvidence.accounting
const summary = [
  '## R4F revision-4 G2C offline shadow',
  '',
  `- observation: \`${accounting.observationId}\``,
  `- mode: \`${result.mode}\``,
  `- ledger range: \`${result.normalizedWork.startLedgerIndex}..${result.normalizedWork.endLedgerIndex}\``,
  `- ledgers/records/chunks: \`${result.normalizedWork.ledgerCount}/${result.normalizedWork.recordCount}/${result.normalizedWork.chunkCount}\``,
  `- normalized payload bytes: \`${result.normalizedWork.payloadBytes}\``,
  `- rolling billable-egress upper bound: \`${accounting.rollingBillableEgressUpperBoundBytes}\``,
  `- memory/transport upper bound: \`${accounting.memoryTransportUpperBoundBytes}\``,
  `- accounting digest: \`${result.accountingEvidence.accountingDigest}\``,
  `- persistence RPC bytes: \`${result.persistenceRpcRequestBytes}\``,
  `- fixed-point iterations: \`${result.fixedPointIterations}\``,
  `- network request issued: \`${!result.checks.noNetworkRequestIssued}\``,
  `- database request issued: \`${!result.checks.noDatabaseRequestIssued}\``,
  `- recovery mutation committed: \`${result.checks.recoveryMutationCommitted}\``,
  `- public reader unchanged: \`${result.checks.publicReaderUnchanged}\``,
  `- Mainnet disabled: \`${result.checks.mainnetDisabled}\``,
  '',
].join('\n')
await writeFile(`${outputDirectory}/evidence.md`, summary)
process.stdout.write(summary)
