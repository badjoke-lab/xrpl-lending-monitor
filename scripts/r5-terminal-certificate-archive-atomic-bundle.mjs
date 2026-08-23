import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ORDERED_STAGES = [
  'ops/production-sql/20260823013000_xrpl_terminal_scan_certificate_runtime.sql',
  'ops/production-sql/20260823045000_xrpl_terminal_generic_scan_certificate_runtime.sql',
  'ops/production-sql/20260823051500_xrpl_terminal_archive_scan_durable_fallback.sql',
]

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--source-commit' || arg === '--output-dir') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      parsed[arg.slice(2)] = value
      i += 1
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  if (!/^[a-f0-9]{40}$/u.test(parsed['source-commit'] ?? '')) {
    throw new Error('--source-commit must be a lowercase 40-character commit SHA')
  }
  if (!parsed['output-dir']) throw new Error('--output-dir is required')
  return {
    sourceCommit: parsed['source-commit'],
    outputDir: resolve(process.cwd(), parsed['output-dir']),
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalize(text) {
  return text.replaceAll('\r\n', '\n')
}

function stripOuterTransaction(sql, path) {
  const normalized = normalize(sql)
  if (!normalized.startsWith('begin;\n')) {
    throw new Error(`${path}: exact leading begin; boundary missing`)
  }
  if (!/\ncommit;\n?$/u.test(normalized)) {
    throw new Error(`${path}: exact trailing commit; boundary missing`)
  }
  const body = normalized.slice('begin;\n'.length).replace(/\ncommit;\n?$/u, '\n')
  if (/^begin;$/gmu.test(body) || /^commit;$/gmu.test(body)) {
    throw new Error(`${path}: unexpected standalone transaction boundary inside stage body`)
  }
  return body
}

function main() {
  const { sourceCommit, outputDir } = parseArgs(process.argv.slice(2))
  mkdirSync(outputDir, { recursive: true })

  const stages = ORDERED_STAGES.map((path, index) => {
    const raw = readFileSync(resolve(process.cwd(), path), 'utf8')
    return {
      order: index + 1,
      path,
      sha256: sha256(raw),
      body: stripOuterTransaction(raw, path),
    }
  })

  const bundle = [
    'begin;',
    '-- Repository-generated atomic review bundle only.',
    '-- Executing this file is NOT authorized by generation or merge.',
    '-- Production requires Issue #1261 prepare -> exact OWNER authorization -> bounded apply -> independent read-only verify.',
    ...stages.flatMap((stage) => [
      '',
      `-- atomic stage ${stage.order}: ${stage.path}`,
      `-- exact source sha256: ${stage.sha256}`,
      stage.body.trimEnd(),
    ]),
    '',
    'commit;',
    '',
  ].join('\n')

  const exactBeginLines = bundle.match(/^begin;$/gmu)?.length ?? 0
  const exactCommitLines = bundle.match(/^commit;$/gmu)?.length ?? 0
  if (exactBeginLines !== 1 || exactCommitLines !== 1) {
    throw new Error(`atomic transaction boundary mismatch: begin=${exactBeginLines} commit=${exactCommitLines}`)
  }

  const manifest = {
    schemaVersion: 1,
    sourceCommit,
    orderedStages: stages.map(({ order, path, sha256: digest }) => ({ order, path, sha256: digest })),
    bundleSha256: sha256(bundle),
    transactionBoundaryCount: { begin: exactBeginLines, commit: exactCommitLines },
    productionApplied: false,
    productionMutationAuthorized: false,
    r5RearmAuthorized: false,
    mainnetEnabled: false,
  }

  writeFileSync(resolve(outputDir, 'terminal-certificate-archive-atomic-bundle.sql'), bundle, 'utf8')
  writeFileSync(resolve(outputDir, 'terminal-certificate-archive-atomic-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  process.stdout.write(`ATOMIC_BUNDLE_MANIFEST=${JSON.stringify(manifest)}\n`)
}

main()
