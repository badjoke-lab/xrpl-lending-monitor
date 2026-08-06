import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const REVISION4_PROFILE_ID = 'supabase_free_postgres_pgcron_edge'
const REVISION4_PROFILE_REVISION = 4
const REVISION4_PROFILE_IDENTITY_DIGEST =
  '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const MEMORY_HALT_BYTES = 224 * 1024 * 1024
const CLAIM_CAP_LEDGERS = 12
const SOURCE_START_LEDGER = 4_138_468
const SOURCE_END_LEDGER = 4_138_491
const SOURCE_LEDGER_COUNT = SOURCE_END_LEDGER - SOURCE_START_LEDGER + 1
const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234/'
const MAX_LEDGER_RESPONSE_BYTES = 1024 * 1024
const FETCH_CONCURRENCY = 2
const BASE_IDENTITY =
  'seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77'
const EPOCH_ID = 'supabase-r4c2c-v1'
const NETWORK = 'devnet'
const AUTHORIZATION_ISSUE = 1261
const AUTHORIZATION_COMMENT = 5401115525
const TEXT_ENCODER = new TextEncoder()

function runtime() {
  const deno = globalThis.Deno
  if (!deno?.version?.deno || !Array.isArray(deno.args)) {
    throw new Error('G4 memory replay must run under Deno')
  }
  return deno
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function byteLength(value) {
  return TEXT_ENCODER.encode(value).byteLength
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function parseArguments(argv) {
  const command = argv[0] ?? ''
  const options = new Map()
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`invalid argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`)
    options.set(key.slice(2), value)
    index += 1
  }
  return { command, options }
}

function requiredOption(options, name) {
  const value = options.get(name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function safeInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function sampleMemory(phase) {
  const usage = runtime().memoryUsage()
  const sample = {
    phase,
    rssBytes: safeInteger(usage.rss, `${phase}.rssBytes`),
    heapTotalBytes: safeInteger(usage.heapTotal, `${phase}.heapTotalBytes`),
    heapUsedBytes: safeInteger(usage.heapUsed, `${phase}.heapUsedBytes`),
    externalBytes: safeInteger(usage.external, `${phase}.externalBytes`),
  }
  if (sample.rssBytes < 1) throw new Error(`${phase}.rssBytes is unavailable`)
  if (sample.heapUsedBytes > sample.heapTotalBytes) {
    throw new Error(`${phase}.heapUsedBytes exceeds heapTotalBytes`)
  }
  return sample
}

async function boundedResponseText(response, maximumBytes, label) {
  if (!response.body) {
    const text = await response.text()
    if (byteLength(text) > maximumBytes) throw new Error(`${label} exceeds byte bound`)
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumBytes) {
        await reader.cancel(`${label} exceeds byte bound`)
        throw new Error(`${label} exceeds byte bound:${bytes}`)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

async function mapLimit(values, limit, operation) {
  const results = new Array(values.length)
  let next = 0
  async function worker() {
    while (true) {
      const index = next
      next += 1
      if (index >= values.length) return
      results[index] = await operation(values[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  )
  return results
}

async function captureLedger(endpoint, ledgerIndex, directory) {
  const requestBody = JSON.stringify({
    method: 'ledger',
    params: [
      {
        api_version: 2,
        ledger_index: ledgerIndex,
        transactions: true,
        expand: true,
        owner_funds: false,
      },
    ],
  })
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await boundedResponseText(
    response,
    MAX_LEDGER_RESPONSE_BYTES,
    `ledger ${ledgerIndex}`,
  )
  if (!response.ok) throw new Error(`ledger ${ledgerIndex} failed:${response.status}`)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`ledger ${ledgerIndex} returned invalid JSON`)
  }
  if (!body?.result || body.result.error) {
    throw new Error(
      `ledger ${ledgerIndex} unavailable:${String(
        body?.result?.error_message ?? body?.result?.error ?? 'missing result',
      )}`,
    )
  }
  const serialized = `${JSON.stringify(body.result)}\n`
  const file = `ledger-${ledgerIndex}.json`
  await writeFile(resolve(directory, file), serialized, 'utf8')
  return {
    ledgerIndex,
    file,
    bytes: byteLength(serialized),
    sha256: sha256(serialized),
  }
}

async function capture(options) {
  const outputDirectory = resolve(requiredOption(options, 'output'))
  const endpoint = options.get('endpoint') ?? DEFAULT_ENDPOINT
  await mkdir(outputDirectory, { recursive: true })
  const indexes = Array.from(
    { length: SOURCE_LEDGER_COUNT },
    (_, index) => SOURCE_START_LEDGER + index,
  )
  const entries = await mapLimit(indexes, FETCH_CONCURRENCY, (ledgerIndex) =>
    captureLedger(endpoint, ledgerIndex, outputDirectory),
  )
  const manifestCore = {
    schemaVersion: 1,
    purpose: 'r4f-g4-public-devnet-source-capture',
    network: NETWORK,
    endpoint,
    sourceStartLedger: SOURCE_START_LEDGER,
    sourceEndLedger: SOURCE_END_LEDGER,
    sourceLedgerCount: SOURCE_LEDGER_COUNT,
    maximumLedgerResponseBytes: MAX_LEDGER_RESPONSE_BYTES,
    fetchConcurrency: FETCH_CONCURRENCY,
    transactionSubmission: 'none',
    databaseMutation: 'none',
    entries,
  }
  const manifest = {
    ...manifestCore,
    capturedAt: new Date().toISOString(),
    manifestCoreSha256: sha256(canonical(manifestCore)),
  }
  await writeFile(
    resolve(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify({ capture: 'success', ...manifestCore, entries: entries.length }))
}

function oneLedgerScan(endpoint, ledger, isLendingTransactionType) {
  const lendingTransactions = ledger.transactions.filter((transaction) =>
    isLendingTransactionType(transaction.transactionType),
  )
  return {
    endpoint,
    startLedgerIndex: ledger.ledgerIndex,
    endLedgerIndex: ledger.ledgerIndex,
    latestValidatedLedger: ledger.ledgerIndex,
    completeToLatest: true,
    ledgers: [{ ...ledger, lendingTransactions }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: ledger.transactions.length,
      lendingTransactions: lendingTransactions.length,
      elapsedMs: 0,
    },
  }
}

function stripSha256Prefix(value, name) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${name} is not a canonical SHA-256 digest`)
  }
  return value.slice('sha256:'.length)
}

async function loadReplayModules() {
  const [transactionTypes, reader, normalization, planner, referenceStore] =
    await Promise.all([
      import('../src/collector/incremental/lending-transaction-types.ts'),
      import('../src/collector/incremental/read-validated-ledger.ts'),
      import('../src/collector/history-segments/portable-xrpl-normalization.ts'),
      import('../src/shared/portable-collector-planner.ts'),
      import('../src/shared/portable-collector-reference-store.ts'),
    ])
  return {
    isLendingTransactionType: transactionTypes.isLendingTransactionType,
    parseValidatedLedgerResult: reader.parseValidatedLedgerResult,
    buildPortableXrplNormalizedWork: normalization.buildPortableXrplNormalizedWork,
    portableReferenceRowsFromChunk: normalization.portableReferenceRowsFromChunk,
    buildPortableCollectorWorkId: planner.buildPortableCollectorWorkId,
    canonicalPortableJson: referenceStore.canonicalPortableJson,
  }
}

async function buildWork(modules, endpoint, ledger, previousLedgerIndex, expectedParentHash) {
  const workId = modules.buildPortableCollectorWorkId({
    network: NETWORK,
    epochId: EPOCH_ID,
    baseIdentity: BASE_IDENTITY,
    previousLedgerIndex,
    expectedParentHash,
  })
  const normalized = await modules.buildPortableXrplNormalizedWork({
    scan: oneLedgerScan(endpoint, ledger, modules.isLendingTransactionType),
    workId,
    network: NETWORK,
    epochId: EPOCH_ID,
    baseIdentity: BASE_IDENTITY,
    previousLedgerIndex,
    expectedParentHash,
  })
  const chunks = await Promise.all(
    normalized.chunks.map(async (built) => {
      const referenceRows = modules.portableReferenceRowsFromChunk(built.chunk)
      const referenceRowsJson = modules.canonicalPortableJson(referenceRows)
      return {
        chunkIndex: built.chunk.chunkIndex,
        totalChunks: built.chunk.totalChunks,
        payloadJson: built.encodedJson,
        chunkDigest: stripSha256Prefix(built.chunk.chunkDigest, 'chunkDigest'),
        encodedDigest: sha256(built.encodedJson),
        byteCount: byteLength(built.encodedJson),
        recordCount: built.chunk.records.length,
        referenceRowsJson,
        referenceRowsDigest: sha256(referenceRowsJson),
      }
    }),
  )
  return {
    workId,
    previousLedgerIndex,
    startLedgerIndex: ledger.ledgerIndex,
    scannedEndLedgerIndex: ledger.ledgerIndex,
    expectedParentHash,
    finalLedgerHash: ledger.ledgerHash,
    planJson: modules.canonicalPortableJson({
      schemaVersion: 1,
      network: NETWORK,
      epochId: EPOCH_ID,
      baseIdentity: BASE_IDENTITY,
      previousLedgerIndex,
      expectedParentHash,
      plannedEndLedgerIndex: ledger.ledgerIndex,
    }),
    semanticCountsJson: normalized.semanticCountsJson,
    payloadDigest: stripSha256Prefix(normalized.payload.digest, 'payloadDigest'),
    chunks,
  }
}

async function readManifest(directory) {
  const text = await readFile(resolve(directory, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(text)
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.purpose !== 'r4f-g4-public-devnet-source-capture' ||
    manifest?.network !== NETWORK ||
    manifest?.sourceStartLedger !== SOURCE_START_LEDGER ||
    manifest?.sourceEndLedger !== SOURCE_END_LEDGER ||
    manifest?.sourceLedgerCount !== SOURCE_LEDGER_COUNT ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length !== SOURCE_LEDGER_COUNT
  ) {
    throw new Error('source capture manifest identity changed')
  }
  const core = {
    schemaVersion: manifest.schemaVersion,
    purpose: manifest.purpose,
    network: manifest.network,
    endpoint: manifest.endpoint,
    sourceStartLedger: manifest.sourceStartLedger,
    sourceEndLedger: manifest.sourceEndLedger,
    sourceLedgerCount: manifest.sourceLedgerCount,
    maximumLedgerResponseBytes: manifest.maximumLedgerResponseBytes,
    fetchConcurrency: manifest.fetchConcurrency,
    transactionSubmission: manifest.transactionSubmission,
    databaseMutation: manifest.databaseMutation,
    entries: manifest.entries,
  }
  if (manifest.manifestCoreSha256 !== sha256(canonical(core))) {
    throw new Error('source capture manifest digest mismatch')
  }
  return manifest
}

async function replay(options) {
  const inputDirectory = resolve(requiredOption(options, 'input'))
  const outputPath = resolve(requiredOption(options, 'output'))
  const shape = requiredOption(options, 'shape')
  if (!['exact', 'heavier'].includes(shape)) throw new Error('unsupported replay shape')

  const memorySamples = [sampleMemory('request_start')]
  const claim = {
    profileId: REVISION4_PROFILE_ID,
    profileRevision: REVISION4_PROFILE_REVISION,
    profileIdentityDigest: REVISION4_PROFILE_IDENTITY_DIGEST,
    ledgerCount: CLAIM_CAP_LEDGERS,
    sourceStartLedger: SOURCE_START_LEDGER,
    sourceEndLedger: SOURCE_START_LEDGER + CLAIM_CAP_LEDGERS - 1,
  }
  memorySamples.push(sampleMemory('after_claim'))

  const manifest = await readManifest(inputDirectory)
  memorySamples.push(sampleMemory('after_head'))
  const retainedLedgerCount = shape === 'exact' ? CLAIM_CAP_LEDGERS : SOURCE_LEDGER_COUNT
  const selectedEntries = manifest.entries.slice(0, retainedLedgerCount)
  const rawLedgerTexts = []
  const modules = await loadReplayModules()
  const retainedLedgers = []
  for (const entry of selectedEntries) {
    const filePath = resolve(inputDirectory, entry.file)
    if (basename(filePath) !== entry.file) throw new Error('capture path traversal rejected')
    const text = await readFile(filePath, 'utf8')
    if (sha256(text) !== entry.sha256 || byteLength(text) !== entry.bytes) {
      throw new Error(`capture digest mismatch:${entry.ledgerIndex}`)
    }
    rawLedgerTexts.push(text)
    const result = JSON.parse(text)
    const parsed = modules.parseValidatedLedgerResult({
      endpoint: manifest.endpoint,
      requestedLedgerIndex: entry.ledgerIndex,
      result,
    })
    retainedLedgers.push({
      ...parsed,
      ledgerHash: parsed.ledgerHash.toUpperCase(),
      parentHash: parsed.parentHash.toUpperCase(),
      transactions: parsed.transactions.map((transaction) => ({
        ...transaction,
        hash: transaction.hash.toUpperCase(),
      })),
    })
  }
  memorySamples.push(sampleMemory('after_fetch'))

  for (const [index, ledger] of retainedLedgers.entries()) {
    const expectedIndex = SOURCE_START_LEDGER + index
    if (ledger.ledgerIndex !== expectedIndex) {
      throw new Error(`retained ledger index mismatch:${expectedIndex}`)
    }
    if (index > 0 && ledger.parentHash !== retainedLedgers[index - 1].ledgerHash) {
      throw new Error(`retained ledger continuity mismatch:${expectedIndex}`)
    }
  }

  const processingLedgers = retainedLedgers.slice(0, CLAIM_CAP_LEDGERS)
  const builtWorks = []
  let previousLedgerIndex = SOURCE_START_LEDGER - 1
  let expectedParentHash = processingLedgers[0]?.parentHash
  if (!expectedParentHash) throw new Error('processing ledger set is empty')
  for (const ledger of processingLedgers) {
    builtWorks.push(
      await buildWork(
        modules,
        manifest.endpoint,
        ledger,
        previousLedgerIndex,
        expectedParentHash,
      ),
    )
    previousLedgerIndex = ledger.ledgerIndex
    expectedParentHash = ledger.ledgerHash
  }
  memorySamples.push(sampleMemory('after_normalize'))
  const worksJson = modules.canonicalPortableJson(builtWorks)
  memorySamples.push(sampleMemory('before_commit'))

  const peakMemoryBytes = Math.max(...memorySamples.map((sample) => sample.rssBytes))
  const baselineMemoryBytes = memorySamples[0].rssBytes
  const result = {
    schemaVersion: 1,
    purpose: 'r4f-g4-bounded-offline-memory-replay-result',
    shape,
    sourceManifestCoreSha256: manifest.manifestCoreSha256,
    sourceStartLedger: SOURCE_START_LEDGER,
    sourceEndLedger: SOURCE_END_LEDGER,
    ledgersClaimed: claim.ledgerCount,
    retainedLedgerCount,
    processedLedgerCount: processingLedgers.length,
    rawRetainedBytes: rawLedgerTexts.reduce((sum, value) => sum + byteLength(value), 0),
    builtWorkCount: builtWorks.length,
    worksBytes: byteLength(worksJson),
    worksSha256: sha256(worksJson),
    baselineMemoryBytes,
    peakMemoryBytes,
    peakAboveBaselineBytes: peakMemoryBytes - baselineMemoryBytes,
    memoryHaltBytes: MEMORY_HALT_BYTES,
    headroomBytes: MEMORY_HALT_BYTES - peakMemoryBytes,
    completedWithoutMemoryHalt: peakMemoryBytes < MEMORY_HALT_BYTES,
    claimCapOverrideUsed: false,
    memorySamples,
    runtime: {
      deno: runtime().version.deno,
      v8: runtime().version.v8,
      typescript: runtime().version.typescript,
      os: runtime().build.os,
      arch: runtime().build.arch,
    },
    safety: {
      networkAccessDuringReplay: false,
      productionCredentialsUsed: false,
      productionMutationPerformed: false,
      recoveryMutationCommitted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  if (!result.completedWithoutMemoryHalt) {
    throw new Error(`memory halt reached:${peakMemoryBytes}`)
  }
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ replay: 'success', shape, ...result }))
}

async function assemble(options) {
  const exactPath = resolve(requiredOption(options, 'exact'))
  const heavierPath = resolve(requiredOption(options, 'heavier'))
  const outputPath = resolve(requiredOption(options, 'output'))
  const summaryPath = resolve(requiredOption(options, 'summary'))
  const sourceCommit = requiredOption(options, 'source-commit')
  const harnessPath = resolve(requiredOption(options, 'harness'))
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('source commit invalid')

  const exact = JSON.parse(await readFile(exactPath, 'utf8'))
  const heavier = JSON.parse(await readFile(heavierPath, 'utf8'))
  if (exact.shape !== 'exact' || heavier.shape !== 'heavier') {
    throw new Error('replay shape outputs are mismatched')
  }
  if (exact.sourceManifestCoreSha256 !== heavier.sourceManifestCoreSha256) {
    throw new Error('replay source manifests differ')
  }
  const environment = {
    deno: runtime().version.deno,
    v8: runtime().version.v8,
    typescript: runtime().version.typescript,
    os: runtime().build.os,
    arch: runtime().build.arch,
  }
  const combinedOutput = canonical({ exact, heavier })
  const evidence = {
    schemaVersion: 1,
    evidenceClass: 'bounded_offline_replay',
    profileId: REVISION4_PROFILE_ID,
    profileRevision: REVISION4_PROFILE_REVISION,
    profileIdentityDigest: REVISION4_PROFILE_IDENTITY_DIGEST,
    evidenceId: `r4f-g4-memory-replay-${sourceCommit.slice(0, 12)}`,
    capturedAt: new Date().toISOString(),
    authorization: {
      issueNumber: AUTHORIZATION_ISSUE,
      commentId: AUTHORIZATION_COMMENT,
      actor: 'badjoke-lab',
      scope: 'r4f_g4_memory_replay',
    },
    policy: {
      memoryMetric: 'process_rss_bytes',
      memoryHaltBytes: MEMORY_HALT_BYTES,
      claimCapLedgers: CLAIM_CAP_LEDGERS,
    },
    samples: [
      {
        sampleId: 'exact-12-ledger-halt-shape',
        shape: 'exact_12_ledger_halt_shape',
        backgroundRecovery: true,
        ledgersClaimed: exact.ledgersClaimed,
        retainedLedgerCount: exact.retainedLedgerCount,
        baselineMemoryBytes: exact.baselineMemoryBytes,
        peakMemoryBytes: exact.peakMemoryBytes,
        completedWithoutMemoryHalt: exact.completedWithoutMemoryHalt,
        claimCapOverrideUsed: exact.claimCapOverrideUsed,
        traceSha256: sha256(canonical(exact.memorySamples)),
        diagnosticsSha256: sha256(canonical(exact)),
      },
      {
        sampleId: 'heavier-24-retained-12-processed',
        shape: 'heavier_retained_sample',
        backgroundRecovery: true,
        ledgersClaimed: heavier.ledgersClaimed,
        retainedLedgerCount: heavier.retainedLedgerCount,
        baselineMemoryBytes: heavier.baselineMemoryBytes,
        peakMemoryBytes: heavier.peakMemoryBytes,
        completedWithoutMemoryHalt: heavier.completedWithoutMemoryHalt,
        claimCapOverrideUsed: heavier.claimCapOverrideUsed,
        traceSha256: sha256(canonical(heavier.memorySamples)),
        diagnosticsSha256: sha256(canonical(heavier)),
      },
    ],
    artifacts: {
      harnessSha256: sha256(await readFile(harnessPath)),
      environmentSha256: sha256(canonical(environment)),
      outputSha256: sha256(combinedOutput),
      sourceCommit,
    },
    safety: {
      productionCredentialsUsed: false,
      productionMutationPerformed: false,
      recoveryMutationCommitted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  const markdown = [
    '## R4F G4 bounded offline memory replay',
    '',
    `- source commit: \`${sourceCommit}\``,
    `- authorization: Issue #${AUTHORIZATION_ISSUE} comment \`${AUTHORIZATION_COMMENT}\``,
    `- profile revision: \`${REVISION4_PROFILE_REVISION}\``,
    `- memory halt: \`${MEMORY_HALT_BYTES}\` bytes`,
    `- claim cap: \`${CLAIM_CAP_LEDGERS}\` ledgers`,
    `- source range: \`${SOURCE_START_LEDGER}-${SOURCE_END_LEDGER}\``,
    `- source manifest digest: \`${exact.sourceManifestCoreSha256}\``,
    `- exact baseline RSS: \`${exact.baselineMemoryBytes}\``,
    `- exact peak RSS: \`${exact.peakMemoryBytes}\``,
    `- exact headroom: \`${exact.headroomBytes}\``,
    `- heavier baseline RSS: \`${heavier.baselineMemoryBytes}\``,
    `- heavier peak RSS: \`${heavier.peakMemoryBytes}\``,
    `- heavier headroom: \`${heavier.headroomBytes}\``,
    `- heavier retained / processed: \`${heavier.retainedLedgerCount}/${heavier.processedLedgerCount}\``,
    `- harness digest: \`${evidence.artifacts.harnessSha256}\``,
    `- environment digest: \`${evidence.artifacts.environmentSha256}\``,
    `- replay output digest: \`${evidence.artifacts.outputSha256}\``,
    '- production credentials: `none`',
    '- production mutation: `none`',
    '- recovery mutation committed: `false`',
    '- public reader unchanged: `true`',
    '- Mainnet disabled: `true`',
    '- stabilization authorized: `false`',
    '- soak authorized: `false`',
    '',
  ].join('\n')
  await writeFile(summaryPath, markdown, 'utf8')
  console.log(JSON.stringify({ assemble: 'success', evidenceId: evidence.evidenceId }))
}

async function main() {
  const { command, options } = parseArguments(runtime().args)
  if (command === 'capture') return capture(options)
  if (command === 'replay') return replay(options)
  if (command === 'assemble') return assemble(options)
  throw new Error('command must be capture, replay, or assemble')
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  runtime().exit(1)
}
