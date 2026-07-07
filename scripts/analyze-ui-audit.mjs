import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const inputDir = process.env.UI_AUDIT_INPUT_DIR ?? 'ui-screenshot-audit/screenshots'
const outputDir = process.env.UI_AUDIT_ANALYSIS_OUTPUT_DIR ?? 'ui-screenshot-audit'

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function asFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function captureKey(profile, name) {
  return `${profile}:${name}`
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

  const expectedCaptures = []
  for (const profile of profiles) {
    for (const route of routes) {
      expectedCaptures.push({ profile: profile.name, name: route.name, route: route.route })
    }
  }
  if (profiles.some((profile) => profile?.name === 'mobile')) {
    expectedCaptures.push({ profile: 'mobile', name: 'more-menu-open', route: '/#mobile-more-open' })
  }

  const captureEntries = entries.filter(
    (entry) =>
      entry &&
      typeof entry.profile === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.route === 'string' &&
      entry.layout,
  )
  const actualKeys = new Set(captureEntries.map((entry) => captureKey(entry.profile, entry.name)))
  const missingCaptures = expectedCaptures.filter(
    (capture) => !actualKeys.has(captureKey(capture.profile, capture.name)),
  )

  const pageHorizontalOverflow = captureEntries
    .map((entry) => ({
      profile: entry.profile,
      name: entry.name,
      route: entry.route,
      overflow_px: asFiniteNumber(entry.layout?.page_horizontal_overflow_px),
    }))
    .filter((entry) => entry.overflow_px > 1)
    .sort((left, right) => right.overflow_px - left.overflow_px)

  const overflowCandidates = captureEntries
    .map((entry) => ({
      profile: entry.profile,
      name: entry.name,
      route: entry.route,
      candidate_count: Array.isArray(entry.layout?.overflowing_elements)
        ? entry.layout.overflowing_elements.length
        : 0,
    }))
    .filter((entry) => entry.candidate_count > 0)
    .sort((left, right) => right.candidate_count - left.candidate_count)

  const technicalFindings = groupTechnicalFindings(entries)
  const technicalFindingCounts = technicalFindings.reduce((counts, finding) => {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1
    return counts
  }, {})

  const summary = {
    analyzed_at: new Date().toISOString(),
    source: {
      captured_at: manifest?.captured_at ?? null,
      base_url: manifest?.base_url ?? null,
      profile_count: profiles.length,
      route_count: routes.length,
    },
    capture_coverage: {
      expected: expectedCaptures.length,
      observed: captureEntries.length,
      missing_count: missingCaptures.length,
      missing: missingCaptures,
    },
    layout: {
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
  }

  summary.review = {
    clean: summary.capture_coverage.missing_count === 0 &&
      summary.layout.page_horizontal_overflow_count === 0 &&
      summary.technical.finding_count === 0,
    requires_visual_review: true,
    notes: [
      'A clean technical summary does not replace human screenshot review.',
      'Overflowing-element candidates are triage hints; only page-level horizontal overflow is classified as a technical defect signal.',
    ],
  }

  return summary
}

export function renderUiAuditMarkdown(summary) {
  const lines = [
    '# UI audit evidence summary',
    '',
    `- Technical summary clean: **${summary.review.clean}**`,
    `- Capture coverage: **${summary.capture_coverage.observed}/${summary.capture_coverage.expected}**`,
    `- Missing captures: **${summary.capture_coverage.missing_count}**`,
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

  lines.push('Human screenshot review remains required even when the technical summary is clean.', '')
  return lines.join('\n')
}

const manifest = JSON.parse(await readFile(path.join(inputDir, 'manifest.json'), 'utf8'))
const diagnostics = JSON.parse(await readFile(path.join(inputDir, 'diagnostics.json'), 'utf8'))
const summary = analyzeUiAuditEvidence(manifest, diagnostics)
const markdown = renderUiAuditMarkdown(summary)

await writeFile(path.join(outputDir, 'analysis-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputDir, 'analysis-summary.md'), markdown, 'utf8')

console.log(markdown)
