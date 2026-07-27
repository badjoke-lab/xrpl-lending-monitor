import { canonicalJson } from '../src/shared/current-state/canonical-json'
import { openGithubHistorySegmentChain } from '../src/shared/history-segments/channel'

const repository = 'badjoke-lab/xrpl-lending-monitor'
const branches = ['history-repair-3932301-data', 'history-data'] as const
const terms = [
  '54A69056FD4D8017F52BB40FA27B6D155F2B07ECF0F24754A26EAF46F82045D0',
  '351B2FB507346B8B001148ED9D92A394D72FCA6CE87109A95B2C61A27B992F6E',
  '2A3920F5B65CDEB35AEE7E4606736A7F0423D804A874EC3225BCD39A7A30A4D4',
  '70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684',
  'AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1',
] as const

const results = []
for (const branch of branches) {
  try {
    const history = await openGithubHistorySegmentChain({
      githubRepository: repository,
      githubBranch: branch,
      timeoutMs: 20_000,
    })
    if (!history.exactIndex) throw new Error('exact index unavailable')
    const lookups = []
    for (const term of terms) {
      const found = await history.exactIndex.reader.find(term, { limit: 100 })
      lookups.push({
        term,
        bucket: found.bucket,
        references: found.references.length,
        ledgers: [...new Set(found.references.map((reference) => reference.ledgerIndex))].sort((a, b) => a - b),
        kinds: [...new Set(found.references.map((reference) => reference.kind))].sort(),
      })
    }
    results.push({
      branch,
      passed: true,
      chainId: history.publication.chainId,
      startLedgerIndex: history.publication.startLedgerIndex,
      endLedgerIndex: history.publication.endLedgerIndex,
      segmentCount: history.publication.segmentCount,
      lookups,
    })
  } catch (error) {
    results.push({
      branch,
      passed: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    })
  }
}

process.stdout.write(`${canonicalJson({ schemaVersion: 1, repository, results })}\n`)
