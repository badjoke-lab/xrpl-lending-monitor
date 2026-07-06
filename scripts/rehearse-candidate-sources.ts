import { GithubCurrentStateReadModelReader } from '../src/shared/current-state/github-read-model-reader'
import { canonicalJson } from '../src/shared/current-state/canonical-json'
import { openGithubHistorySegmentChain } from '../src/shared/history-segments/channel'

function value(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const result = args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value`)
  return result
}

function required(args: readonly string[], name: string): string {
  const result = value(args, name)
  if (result === null) throw new Error(`${name} is required`)
  return result
}

function objectId(kind: 'vault' | 'loan-broker' | 'loan', value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${kind} sample is invalid`)
  const record = value as Record<string, unknown>
  const projection = kind === 'vault'
    ? record
    : kind === 'loan-broker'
      ? record.broker as Record<string, unknown>
      : record.loan as Record<string, unknown>
  const id = projection?.id
  if (typeof id !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(id)) throw new Error(`${kind} sample id is invalid`)
  return id.toUpperCase()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('Candidate source rehearsal requires --local')
  const repository = required(args, '--repository')
  const historyBranch = required(args, '--history-branch')
  const currentStateBranch = required(args, '--current-state-branch')

  const history = await openGithubHistorySegmentChain({
    githubRepository: repository,
    githubBranch: historyBranch,
    timeoutMs: 12_000,
  })
  if (!history.exactIndex) throw new Error('Candidate history exact index is unavailable')

  const current = await GithubCurrentStateReadModelReader.open({
    githubRepository: repository,
    githubBranch: currentStateBranch,
  })

  if (current.manifest.epochId !== history.publication.epochId) {
    throw new Error('Candidate source epoch mismatch')
  }
  if (current.manifest.ledgerIndex !== history.publication.endLedgerIndex) {
    throw new Error('Candidate current-state ledger does not match history terminal ledger')
  }
  if (current.manifest.ledgerHash !== history.publication.endLedgerHash) {
    throw new Error('Candidate current-state hash does not match history terminal hash')
  }

  const kinds = ['vault', 'loan-broker', 'loan'] as const
  const currentReads: Record<string, unknown> = {}
  for (const kind of kinds) {
    const listed = await current.list<unknown>(kind, {
      limit: 1,
      direction: 'desc',
      scope: `candidate-rehearsal:${kind}`,
      maxPageReads: 1,
    })
    if (listed.items.length !== 1) throw new Error(`Candidate ${kind} list did not return one item`)
    const id = objectId(kind, listed.items[0])
    const exact = await current.get<unknown>(id, kind)
    if (!exact) throw new Error(`Candidate ${kind} exact lookup failed`)
    currentReads[kind] = {
      id,
      pageReads: listed.pageReads,
      objectsExamined: listed.objectsExamined,
    }
  }

  const exactTerms = [
    '54A69056FD4D8017F52BB40FA27B6D155F2B07ECF0F24754A26EAF46F82045D0',
    '351B2FB507346B8B001148ED9D92A394D72FCA6CE87109A95B2C61A27B992F6E',
    '2A3920F5B65CDEB35AEE7E4606736A7F0423D804A874EC3225BCD39A7A30A4D4',
  ]
  const exactReads = []
  for (const term of exactTerms) {
    const result = await history.exactIndex.reader.find(term, { limit: 100 })
    if (result.references.length < 1) throw new Error(`Candidate exact history term is unavailable: ${term}`)
    exactReads.push({ term: result.term, references: result.references.length, bucket: result.bucket, assetReads: result.assetReads })
  }

  const recent = await history.reader.list<unknown>({
    kind: 'protocol_events',
    limit: 1,
    direction: 'desc',
    maxSegmentReads: 4,
    maxWallTimeMs: 5_000,
  })

  const summary = {
    schemaVersion: 1,
    passed: true,
    repository,
    historyBranch,
    currentStateBranch,
    epochId: history.publication.epochId,
    ledgerIndex: history.publication.endLedgerIndex,
    ledgerHash: history.publication.endLedgerHash,
    chainId: history.publication.chainId,
    segmentCount: history.publication.segmentCount,
    ledgerCount: history.publication.ledgerCount,
    currentStateSnapshotId: current.manifest.snapshotId,
    currentStateManifestSha256: current.manifest.manifestSha256,
    currentReads,
    exactReads,
    recentHistory: {
      items: recent.items.length,
      segmentReads: recent.segmentReads,
      recordsExamined: recent.recordsExamined,
    },
  }
  process.stdout.write(`${canonicalJson(summary)}\n`)
}

await main()
