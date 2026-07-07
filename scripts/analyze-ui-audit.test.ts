import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const emptyLayout = {
  page_horizontal_overflow_px: 0,
  overflowing_elements: [],
}

function cleanDiagnostics() {
  return [
    { profile: 'desktop', name: 'overview', route: '/', layout: emptyLayout },
    { profile: 'desktop', technical_findings: [] },
    { profile: 'mobile', name: 'overview', route: '/', layout: emptyLayout },
    {
      profile: 'mobile',
      name: 'more-menu-open',
      route: '/#mobile-more-open',
      layout: emptyLayout,
    },
    { profile: 'mobile', technical_findings: [] },
  ]
}

async function runAnalyzer(
  diagnostics: unknown,
  options: { requireClean?: boolean; expectedStatus?: number } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'xrpl-ui-audit-'))
  tempDirs.push(root)
  const inputDir = path.join(root, 'screenshots')
  const outputDir = path.join(root, 'analysis')
  await mkdir(inputDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })

  const manifest = {
    captured_at: '2026-07-08T00:00:00.000Z',
    base_url: 'https://example.test',
    profiles: [
      { name: 'desktop', viewport: { width: 1440, height: 1000 } },
      { name: 'mobile', viewport: { width: 390, height: 844 } },
    ],
    routes: [{ name: 'overview', route: '/' }],
  }

  await writeFile(path.join(inputDir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  await writeFile(path.join(inputDir, 'diagnostics.json'), JSON.stringify(diagnostics), 'utf8')

  const result = spawnSync(process.execPath, ['scripts/analyze-ui-audit.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      UI_AUDIT_INPUT_DIR: inputDir,
      UI_AUDIT_ANALYSIS_OUTPUT_DIR: outputDir,
      REQUIRE_UI_AUDIT_TECHNICAL_CLEAN: options.requireClean ? 'true' : 'false',
    },
    encoding: 'utf8',
  })

  expect(result.status, result.stderr).toBe(options.expectedStatus ?? 0)
  return JSON.parse(await readFile(path.join(outputDir, 'analysis-summary.json'), 'utf8'))
}

describe('UI audit evidence analyzer', () => {
  it('reports complete clean technical evidence while preserving visual-review requirement', async () => {
    const summary = await runAnalyzer(cleanDiagnostics())

    expect(summary.capture_coverage).toMatchObject({
      passed: true,
      expected: 3,
      observed: 3,
      missing_count: 0,
      duplicate_count: 0,
      unexpected_count: 0,
    })
    expect(summary.layout.page_horizontal_overflow_count).toBe(0)
    expect(summary.technical.finding_count).toBe(0)
    expect(summary.review).toMatchObject({
      clean: true,
      technical_passed: true,
      requires_visual_review: true,
    })
  })

  it('summarizes missing captures, page overflow, and technical findings', async () => {
    const diagnostics = cleanDiagnostics().filter(
      (entry) => !('name' in entry) || entry.name !== 'more-menu-open',
    )
    const desktopRoute = diagnostics[0] as {
      layout: { page_horizontal_overflow_px: number; overflowing_elements: unknown[] }
    }
    desktopRoute.layout = {
      page_horizontal_overflow_px: 24,
      overflowing_elements: [{ tag: 'table' }],
    }
    const desktopTechnical = diagnostics[1] as { technical_findings: unknown[] }
    desktopTechnical.technical_findings = [
      { route: '/', type: 'console_error', message: 'test error' },
      { route: '/', type: 'http_error', status: 500, url: 'https://example.test/api/test' },
    ]

    const summary = await runAnalyzer(diagnostics)

    expect(summary.capture_coverage.missing_count).toBe(1)
    expect(summary.capture_coverage.missing[0]).toMatchObject({
      profile: 'mobile',
      name: 'more-menu-open',
    })
    expect(summary.capture_coverage.passed).toBe(false)
    expect(summary.layout.page_horizontal_overflow_count).toBe(1)
    expect(summary.layout.overflow_candidate_route_count).toBe(1)
    expect(summary.technical).toMatchObject({
      finding_count: 2,
      counts_by_type: { console_error: 1, http_error: 1 },
    })
    expect(summary.review.technical_passed).toBe(false)
  })

  it('fails coverage on duplicate and unexpected capture diagnostics', async () => {
    const diagnostics = cleanDiagnostics()
    diagnostics.push({ profile: 'desktop', name: 'overview', route: '/', layout: emptyLayout })
    diagnostics.push({ profile: 'desktop', name: 'unexpected', route: '/unexpected', layout: emptyLayout })

    const summary = await runAnalyzer(diagnostics)

    expect(summary.capture_coverage.passed).toBe(false)
    expect(summary.capture_coverage.duplicate_count).toBe(1)
    expect(summary.capture_coverage.unexpected_count).toBe(1)
    expect(summary.review.technical_passed).toBe(false)
  })

  it('fails coverage when a profile technical-finding record is missing', async () => {
    const diagnostics = cleanDiagnostics().filter(
      (entry) => !('technical_findings' in entry) || entry.profile !== 'mobile',
    )

    const summary = await runAnalyzer(diagnostics)

    expect(summary.capture_coverage.passed).toBe(false)
    expect(summary.capture_coverage.missing_technical_profiles).toEqual(['mobile'])
    expect(summary.review.technical_passed).toBe(false)
  })

  it('keeps nested overflow candidates reviewable without treating them as technical failure', async () => {
    const diagnostics = cleanDiagnostics()
    const mobileRoute = diagnostics[2] as {
      layout: { page_horizontal_overflow_px: number; overflowing_elements: unknown[] }
    }
    mobileRoute.layout = {
      page_horizontal_overflow_px: 0,
      overflowing_elements: [{ tag: 'code', internal_overflow_px: 40, overflow_x: 'hidden' }],
    }

    const summary = await runAnalyzer(diagnostics)

    expect(summary.layout.page_horizontal_overflow_count).toBe(0)
    expect(summary.layout.overflow_candidate_route_count).toBe(1)
    expect(summary.review.technical_passed).toBe(true)
    expect(summary.review.requires_visual_review).toBe(true)
  })

  it('returns a failing process status after writing evidence when strict mode finds defects', async () => {
    const diagnostics = cleanDiagnostics()
    const desktopTechnical = diagnostics[1] as { technical_findings: unknown[] }
    desktopTechnical.technical_findings = [{ route: '/', type: 'page_error', message: 'boom' }]

    const summary = await runAnalyzer(diagnostics, { requireClean: true, expectedStatus: 1 })

    expect(summary.technical.finding_count).toBe(1)
    expect(summary.review.technical_passed).toBe(false)
  })
})
