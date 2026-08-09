import { readFile, writeFile } from 'node:fs/promises'

import { buildSupabaseRevision4ProviderCaptureEvidence } from '../src/shared/supabase-revision4-provider-capture'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const inputPath = argument('--input')
const outputPath = argument('--output')
const requireQualified = process.argv.includes('--require-qualified')

if (!inputPath || !outputPath) {
  throw new Error(
    'usage: verify-r4f-revision4-provider-capture --input <json> --output <json> [--require-qualified]',
  )
}

const parsed = JSON.parse(await readFile(inputPath, 'utf8'))
const { evidenceClass: _evidenceClass, ...input } = parsed
const evidence = buildSupabaseRevision4ProviderCaptureEvidence(input)
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)

process.stdout.write(
  `${JSON.stringify({
    outputPath,
    captureId: evidence.captureId,
    captureState: evidence.captureState,
    authorizationVerified: evidence.authorizationVerified,
    authorizationPrecedesBefore: evidence.authorizationPrecedesBefore,
    providerSurfaceVerified: evidence.providerSurfaceVerified,
    providerUsageFresh: evidence.providerUsageFreshness.verified,
    providerUsageInvocationDelta: evidence.providerUsageFreshness.invocationDelta,
    providerDeltaInterval: evidence.reconciliation.providerDeltaInterval,
    selectedUnexplainedDeltaReserveBytes:
      evidence.reconciliation.selectedUnexplainedDeltaReserveBytes,
    g3Qualified: evidence.g3Qualified,
    profileSelected: evidence.profileSelected,
    r5Authorized: evidence.r5Authorized,
  })}\n`,
)

if (requireQualified && !evidence.g3Qualified) {
  process.exitCode = 2
}
