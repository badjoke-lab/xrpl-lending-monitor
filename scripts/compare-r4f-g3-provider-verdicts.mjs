import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

export function compareR4fG3ProviderVerdicts(productionEvidence, independentEvidence) {
  const productionQualified = productionEvidence?.g3Qualified === true
  const independentQualified = independentEvidence?.auditQualified === true
  const sameProfile =
    productionEvidence?.profileId === independentEvidence?.expectedProfileId &&
    productionEvidence?.profileRevision === independentEvidence?.expectedProfileRevision &&
    productionEvidence?.profileIdentityDigest === independentEvidence?.expectedProfileIdentityDigest
  const sameCapture = productionEvidence?.captureId === independentEvidence?.captureId
  const productionDelta = productionEvidence?.reconciliation?.providerDeltaInterval
  const independentDelta = independentEvidence?.reconciliation
  const sameProviderInterval =
    productionDelta?.lowerBoundBytes === independentDelta?.providerDeltaLowerBoundBytes &&
    productionDelta?.upperBoundBytes === independentDelta?.providerDeltaUpperBoundBytes
  const sameSelectedReserve =
    productionEvidence?.reconciliation?.selectedUnexplainedDeltaReserveBytes ===
    independentDelta?.selectedUnexplainedDeltaReserveBytes
  const agreement =
    productionQualified === independentQualified &&
    sameProfile &&
    sameCapture &&
    sameProviderInterval &&
    sameSelectedReserve
  const dualQualified = agreement && productionQualified && independentQualified

  return {
    schemaVersion: 1,
    verifier: 'r4f_g3_provider_dual_verdict_v1',
    productionQualified,
    independentQualified,
    sameProfile,
    sameCapture,
    sameProviderInterval,
    sameSelectedReserve,
    agreement,
    dualQualified,
    profileSelected: false,
    r5Authorized: false,
  }
}

async function main() {
  const productionPath = argument('--production')
  const independentPath = argument('--independent')
  const outputPath = argument('--output')
  const requireQualified = process.argv.includes('--require-qualified')
  if (!productionPath || !independentPath || !outputPath) {
    throw new Error(
      'usage: compare-r4f-g3-provider-verdicts --production <json> --independent <json> --output <json> [--require-qualified]',
    )
  }
  const [productionEvidence, independentEvidence] = await Promise.all([
    readFile(productionPath, 'utf8').then(JSON.parse),
    readFile(independentPath, 'utf8').then(JSON.parse),
  ])
  const result = compareR4fG3ProviderVerdicts(productionEvidence, independentEvidence)
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (requireQualified && !result.dualQualified) process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
