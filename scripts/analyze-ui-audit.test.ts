import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function runAnalyzer(diagnostics: unknown) {
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
    },
    encoding: 'utf8',
  })

  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(await readFile(path.join(outputDir, 'analysis-summary.json'), 'utf8'))
}

describe('UI audit evidence analyzer', () => {
  it('reports complete clean technical evidence while preserving visual-review requirement', async () => {
    const emptyLayout = {
      page_horizontal_overflow_px: 0,
      overflowing_elements: [],
    }
    const summary = await runAnalyzer([
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
    ])

    expect(summary.capture_coverage).toMatchObject({ expected: 3, observed: 3, missing_count: 0 })
    expect(summary.layout.page_horizontal_overflow_count).toBe(0)
    expect(summary.technical.finding_count).toBe(0)
    expect(summary.review).toMatchObject({ clean: true, requires_visual_review: true })
  })

  it('summarizes missing captures, page overflow, and technical findings', async () => {
    const summary = await runAnalyzer([
      {
        profile: 'desktop',
        name: 'overview',
        route: '/',
        layout: {
          page_horizontal_overflow_px: 24,
          overflowing_elements: [{ tag: 'table' }],
        },
      },
      {
        profile: 'desktop',
        technical_findings: [
          { route: '/', type: 'console_error', message: 'test error' },
          { route: '/', type: 'http_error', status: 500, url: 'https://example.test/api/test' },
        ],
      },
      {
        profile: 'mobile',
        name: 'overview',
        route: '/',
        layout: { page_horizontal_overflow_px: 0, overflowing_elements: [] },
      },
      { profile: 'mobile', technical_findings: [] },
    ])

    expect(summary.capture_coverage.missing_count).toBe(1)
    expect(summary.capture_coverage.missing[0]).toMatchObject({
      profile: 'mobile',
      name: 'more-menu-open',
    })
    expect(summary.layout.page_horizontal_overflow_count).toBe(1)
    expect(summary.layout.overflow_candidate_route_count).toBe(1)
    expect(summary.technical).toMatchObject({
      finding_count: 2,
      counts_by_type: { console_error: 1, http_error: 1 },
    })
    expect(summary.review.clean).toBe(false)
  })
})
