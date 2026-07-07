import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OVERFLOW_TOLERANCE_PX = 1

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function captureKey(profile, name, route) {
  return `${profile}\u0000${name}\u0000${route}`
}

export function evaluateAuditEvidence(manifest, diagnostics) {
  const profiles = assertArray(manifest?.profiles, 'manifest.profiles')
  const routes = assertArray(manifest?.routes, 'manifest.routes')
  const records = assertArray(diagnostics, 'diagnostics')

  const profileNames = profiles.map((profile) => profile?.name).filter((name) => typeof name === 'string' && name.length > 0)
  if (profileNames.length !== profiles.length) throw new Error('Every manifest profile must have a non-empty name')

  const expectedCaptures = []
  for (const profile of profileNames) {
    for (const route of routes) {
      if (typeof route?.name !== 'string' || typeof route?.route !== 'string') {
        throw new Error('Every manifest route must have string name and route fields')
      }
      expectedCaptures.push({ profile, name: route.name, route: route.route })
    }
  }

  if (profileNames.includes('mobile')) {
    expectedCaptures.push({ profile: 'mobile', name: 'more-menu-open', route: '/#mobile-more-open' })
  }

  const routeRecords = records.filter((record) => record?.layout != null)
  const technicalRecords = records.filter((record) => Array.isArray(record?.technical_findings))

  const expectedKeys = new Set(expectedCaptures.map((capture) => captureKey(capture.profile, capture.name, capture.route)))
  const actualCounts = new Map()
  for (const record of routeRecords) {
    const key = captureKey(record?.profile, record?.name, record?.route)
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1)
  }

  const missingCaptures = expectedCaptures.filter(
    (capture) => !actualCounts.has(captureKey(capture.profile, capture.name, capture.route)),
  )
  const duplicateCaptures = [...actualCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
  const unexpectedCaptures = routeRecords
    .filter((record) => !expectedKeys.has(captureKey(record?.profile, record?.name, record?.route)))
    .map((record) => ({ profile: record?.profile ?? null, name: record?.name ?? null, route: record?.route ?? null }))

  const technicalProfiles = new Set(technicalRecords.map((record) => record?.profile))
  const missingTechnicalProfiles = profileNames.filter((profile) => !technicalProfiles.has(profile))
  const duplicateTechnicalProfiles = profileNames
    .map((profile) => ({
      profile,
      count: technicalRecords.filter((record) => record?.profile === profile).length,
    }))
    .filter((item) => item.count > 1)

  const pageOverflowFindings = routeRecords
    .filter((record) => Number(record?.layout?.page_horizontal_overflow_px ?? 0) > OVERFLOW_TOLERANCE_PX)
    .map((record) => ({
      profile: record.profile,
      name: record.name,
      route: record.route,
      page_horizontal_overflow_px: Number(record.layout.page_horizontal_overflow_px),
    }))

  const overflowReviewCandidates = routeRecords
    .filter((record) => Array.isArray(record?.layout?.overflowing_elements) && record.layout.overflowing_elements.length > 0)
    .map((record) => ({
      profile: record.profile,
      name: record.name,
      route: record.route,
      candidate_count: record.layout.overflowing_elements.length,
    }))

  const technicalFindings = technicalRecords.flatMap((record) =>
    record.technical_findings.map((finding) => ({
      profile: record.profile ?? null,
      route: finding?.route ?? null,
      type: finding?.type ?? 'unknown',
      status: finding?.status ?? null,
      message: finding?.message ?? null,
      url: finding?.url ?? null,
    })),
  )

  const coveragePassed =
    missingCaptures.length === 0 &&
    duplicateCaptures.length === 0 &&
    unexpectedCaptures.length === 0 &&
    missingTechnicalProfiles.length === 0 &&
    duplicateTechnicalProfiles.length === 0

  const technicalPassed = coveragePassed && pageOverflowFindings.length === 0 && technicalFindings.length === 0

  return {
    evaluated_at: new Date().toISOString(),
    technical_passed: technicalPassed,
    visual_review_required: true,
    overflow_tolerance_px: OVERFLOW_TOLERANCE_PX,
    coverage: {
      passed: coveragePassed,
      expected_capture_count: expectedCaptures.length,
      actual_route_diagnostic_count: routeRecords.length,
      expected_technical_profile_count: profileNames.length,
      actual_technical_profile_count: technicalRecords.length,
      missing_captures: missingCaptures,
      duplicate_captures: duplicateCaptures,
      unexpected_captures: unexpectedCaptures,
      missing_technical_profiles: missingTechnicalProfiles,
      duplicate_technical_profiles: duplicateTechnicalProfiles,
    },
    page_horizontal_overflow_count: pageOverflowFindings.length,
    page_horizontal_overflow_findings: pageOverflowFindings,
    overflow_review_candidate_route_count: overflowReviewCandidates.length,
    overflow_review_candidates: overflowReviewCandidates,
    technical_finding_count: technicalFindings.length,
    technical_findings: technicalFindings,
  }
}

async function runCli() {
  const auditDir = process.env.AUDIT_DIR ?? process.argv[2] ?? 'ui-screenshot-audit/screenshots'
  const manifestPath = path.join(auditDir, 'manifest.json')
  const diagnosticsPath = path.join(auditDir, 'diagnostics.json')
  const outputPath = path.join(auditDir, 'evaluation.json')

  const [manifestText, diagnosticsText] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(diagnosticsPath, 'utf8'),
  ])

  const evaluation = evaluateAuditEvidence(JSON.parse(manifestText), JSON.parse(diagnosticsText))
  await writeFile(outputPath, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(evaluation, null, 2))

  if (process.env.REQUIRE_UI_AUDIT_TECHNICAL_CLEAN === 'true' && !evaluation.technical_passed) {
    process.exitCode = 1
  }
}

const isCli = process.argv[1] != null && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) await runCli()
