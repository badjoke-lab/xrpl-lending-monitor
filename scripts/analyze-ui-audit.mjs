import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const inputDir = process.env.UI_AUDIT_INPUT_DIR ?? 'ui-screenshot-audit/screenshots'
const outputDir = process.env.UI_AUDIT_ANALYSIS_OUTPUT_DIR ?? 'ui-screenshot-audit'
const overflowTolerancePx = 1

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function asFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function captureKey(profile, name, route) {
  return `${profile}\u0000${name}\u0000${route}`
}

function groupTechnicalFindings(entries) {
  const findings = []
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.technical_findings)) continue
    for (const finding of entry.technical_findings) {
      findings.push({
        profile: entry.profile ?? null,
        route: finding?.route ?? null,
        type: finding?.type ?? 'unknown',
        status: finding?.status ?? null,
        url: finding?.url ?? null,
        message: finding?.message ?? null,
      })
    }
  }
  return findings
}

export function analyzeUiAuditEvidence(manifest, diagnostics) {
  const profiles = assertArray(manifest?.profiles, 'manifest.profiles')
  const routes = assertArray(manifest?.routes, 'manifest.routes')
  const entries = assertArray(diagnostics, 'diagnostics')

  const profileNames = profiles.map((profile) => profile?.name)
  if (profileNames.some((name) => typeof name !== 'string' || name.length === 0)) {
    throw new Error('Every manifest profile must have a non-empty string name')
  }
  if (new Set(profileNames).size !== profileNames.length) {
    throw new Error('Manifest profile names must be unique')
  }

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

  const captureEntries = entries.filter((entry) => entry?.layout != null)
  const technicalEntries = entries.filter((entry) => Array.isArray(entry?.technical_findings))
  const expectedKeys = new Set(
    expectedCaptures.map((capture) => captureKey(capture.profile, capture.name, capture.route)),
  )

  const actualCounts = new Map()
  for (const entry of captureEntries) {
    const key = captureKey(entry?.profile, entry?.name, entry?.route)
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1)
  }

  const missingCaptures = expectedCaptures.filter(
    (capture) => !actualCounts.has(captureKey(capture.profile, capture.name, capture.route)),
  )
  const duplicateCaptures = [...actualCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
  const unexpectedCaptures = captureEntries
    .filter((entry) => !expectedKeys.has(captureKey(entry?.profile, entry?.name, entry?.route)))
    .map((entry) => ({
      profile: entry?.profile ?? null,
      name: entry?.name ?? null,
      route: entry?.route ?? null,
    }))

  const technicalProfileCounts = new Map()
  for (const entry of technicalEntries) {
    technicalProfileCounts.set(entry?.profile, (technicalProfileCounts.get(entry?.profile) ?? 0) + 1)
  }
  const missingTechnicalProfiles = profileNames.filter(
    (profile) => !technicalProfileCounts.has(profile),
  )
  const duplicateTechnicalProfiles = profileNames
    .map((profile) => ({ profile, count: technicalProfileCounts.get(profile) ?? 0 }))
    .filter((entry) => entry.count > 1)
  const unexpectedTechnicalProfiles = [...technicalProfileCounts.keys()]
    .filter((profile) => !profileNames.includes(profile))
    .map((profile) => ({ profile, count: technicalProfileCounts.get(profile) }))

  const coveragePassed =
    missingCaptures.length === 0 &&
    duplicateCaptures.length === 0 &&
    unexpectedCaptures.length === 0 &&
    missingTechnicalProfiles.length === 0 &&
    duplicateTechnicalProfiles.length === 0 &&
    unexpectedTechnicalProfiles.length === 0

  const pageHorizontalOverflow = captureEntries
    .map((entry) => ({
      profile: entry?.profile ?? null,
      name: entry?.name ?? null,
      route: entry?.route ?? null,
      overflow_px: asFiniteNumber(entry?.layout?.page_horizontal_overflow_px),
    }))
    .filter((entry) => entry.overflow_px > overflowTolerancePx)
    .sort((left, right) => right.overflow_px - left.overflow_px)

  const overflowCandidates = captureEntries
    .map((entry) => ({
      profile: entry?.profile ?? null,
      name: entry?.name ?? null,
      route: entry?.route ?? null,
      candidate_count: Array.isArray(entry?.layout?.overflowing_elements)
        ? entry.layout.overflowing_elements.length
        : 0,
    }))
    .filter((entry) => entry.candidate_count > 0)
    .sort((left, right) => right.candidate_count - left.candidate_count)

  const technicalFindings = groupTechnicalFindings(technicalEntries)
  const technicalFindingCounts = technicalFindings.reduce((counts, finding) => {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1
    return counts
  }, {})

  const clean =
    coveragePassed &&
    pageHorizontalOverflow.length === 0 &&
    technicalFindings.length === 0

  return {
    analyzed_at: new Date().toISOString(),
    source: {
      captured_at: manifest?.captured_at ?? null,
      base_url: manifest?.base_url ?? null,
      profile_count: profiles.length,
      route_count: routes.length,
    },
    capture_coverage: {
      passed: coveragePassed,
      expected: expectedCaptures.length,
      observed: captureEntries.length,
      missing_count: missingCaptures.length,
      missing: missingCaptures,
      duplicate_count: duplicateCaptures.length,
      duplicates: duplicateCaptures,
      unexpected_count: unexpectedCaptures.length,
      unexpected: unexpectedCaptures,
      expected_technical_profile_count: profileNames.length,
      observed_technical_profile_count: technicalEntries.length,
      missing_technical_profiles: missingTechnicalProfiles,
      duplicate_technical_profiles: duplicateTechnicalProfiles,
      unexpected_technical_profiles: unexpectedTechnicalProfiles,
    },
    layout: {
      overflow_tolerance_px: overflowTolerancePx,
      page_horizontal_overflow_count: pageHorizontalOverflow.length,
      page_horizontal_overflow: pageHorizontalOverflow,
      overflow_candidate_route_count: overflowCandidates.length,
      overflow_candidates: overflowCandidates,
    },
    technical: {
      finding_count: technicalFindings.length,
      counts_by_type: technicalFindingCounts,
      findings: technicalFindings,
    },
    review: {
      clean,
      technical_passed: clean,
      requires_visual_review: true,
      notes: [
        'A clean technical summary does not replace human screenshot review.',
        'Overflowing-element candidates are triage hints; only page-level horizontal overflow is classified as a technical defect signal.',
      ],
    },
  }
}

export function renderUiAuditMarkdown(summary) {
  const lines = [
    '# UI audit evidence summary',
    '',
    `- Technical evaluation passed: **${summary.review.technical_passed}**`,
    `- Capture coverage passed: **${summary.capture_coverage.passed}**`,
    `- Capture coverage: **${summary.capture_coverage.observed}/${summary.capture_coverage.expected}**`,
    `- Missing captures: **${summary.capture_coverage.missing_count}**`,
    `- Duplicate captures: **${summary.capture_coverage.duplicate_count}**`,
    `- Unexpected captures: **${summary.capture_coverage.unexpected_count}**`,
    `- Page-level horizontal overflow routes: **${summary.layout.page_horizontal_overflow_count}**`,
    `- Routes with overflow-element candidates: **${summary.layout.overflow_candidate_route_count}**`,
    `- Browser/runtime/HTTP findings: **${summary.technical.finding_count}**`,
    '',
  ]

  if (summary.capture_coverage.missing_count > 0) {
    lines.push('## Missing captures', '')
    for (const capture of summary.capture_coverage.missing) {
      lines.push(`- ${capture.profile} · ${capture.name} · \`${capture.route}\``)
    }
    lines.push('')
  }

  if (summary.layout.page_horizontal_overflow_count > 0) {
    lines.push('## Page-level horizontal overflow', '')
    for (const finding of summary.layout.page_horizontal_overflow) {
      lines.push(`- ${finding.profile} · ${finding.name} · \`${finding.route}\`: ${finding.overflow_px}px`)
    }
    lines.push('')
  }

  if (summary.technical.finding_count > 0) {
    lines.push('## Technical findings', '')
    for (const [type, count] of Object.entries(summary.technical.counts_by_type).sort()) {
      lines.push(`- ${type}: ${count}`)
    }
    lines.push('')
  }

  lines.push('Human screenshot review remains required even when the technical evaluation passes.', '')
  return lines.join('\n')
}

const manifest = JSON.parse(await readFile(path.join(inputDir, 'manifest.json'), 'utf8'))
const diagnostics = JSON.parse(await readFile(path.join(inputDir, 'diagnostics.json'), 'utf8'))
const summary = analyzeUiAuditEvidence(manifest, diagnostics)
const markdown = renderUiAuditMarkdown(summary)

await writeFile(path.join(outputDir, 'analysis-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputDir, 'analysis-summary.md'), markdown, 'utf8')

console.log(markdown)

if (process.env.REQUIRE_UI_AUDIT_TECHNICAL_CLEAN === 'true' && !summary.review.technical_passed) {
  process.exitCode = 1
}
