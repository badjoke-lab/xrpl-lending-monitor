import { describe, expect, it } from 'vitest'
import { evaluateAuditEvidence } from './evaluate-ui-audit.mjs'

const manifest = {
  profiles: [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'mobile', viewport: { width: 390, height: 844 } },
  ],
  routes: [{ name: 'overview', route: '/' }],
}

function cleanRoute(profile, name, route) {
  return {
    profile,
    name,
    route,
    layout: {
      viewport_width: profile === 'mobile' ? 390 : 1440,
      page_scroll_width: profile === 'mobile' ? 390 : 1440,
      page_horizontal_overflow_px: 0,
      overflowing_elements: [],
    },
  }
}

function cleanDiagnostics() {
  return [
    cleanRoute('desktop', 'overview', '/'),
    { profile: 'desktop', technical_findings: [] },
    cleanRoute('mobile', 'overview', '/'),
    cleanRoute('mobile', 'more-menu-open', '/#mobile-more-open'),
    { profile: 'mobile', technical_findings: [] },
  ]
}

describe('evaluateAuditEvidence', () => {
  it('passes complete technically clean evidence', () => {
    const result = evaluateAuditEvidence(manifest, cleanDiagnostics())

    expect(result.technical_passed).toBe(true)
    expect(result.coverage.passed).toBe(true)
    expect(result.coverage.expected_capture_count).toBe(3)
    expect(result.page_horizontal_overflow_count).toBe(0)
    expect(result.technical_finding_count).toBe(0)
    expect(result.visual_review_required).toBe(true)
  })

  it('fails technical evaluation when page-level horizontal overflow is present', () => {
    const diagnostics = cleanDiagnostics()
    diagnostics[0].layout.page_horizontal_overflow_px = 12

    const result = evaluateAuditEvidence(manifest, diagnostics)

    expect(result.technical_passed).toBe(false)
    expect(result.page_horizontal_overflow_count).toBe(1)
    expect(result.page_horizontal_overflow_findings[0]).toMatchObject({
      profile: 'desktop',
      route: '/',
      page_horizontal_overflow_px: 12,
    })
  })

  it('fails technical evaluation for browser/runtime/http findings', () => {
    const diagnostics = cleanDiagnostics()
    diagnostics[1].technical_findings.push({
      route: '/',
      type: 'console_error',
      message: 'boom',
    })

    const result = evaluateAuditEvidence(manifest, diagnostics)

    expect(result.technical_passed).toBe(false)
    expect(result.technical_finding_count).toBe(1)
    expect(result.technical_findings[0]).toMatchObject({
      profile: 'desktop',
      route: '/',
      type: 'console_error',
      message: 'boom',
    })
  })

  it('fails closed when expected capture evidence is missing', () => {
    const diagnostics = cleanDiagnostics().filter((record) => record.name !== 'more-menu-open')

    const result = evaluateAuditEvidence(manifest, diagnostics)

    expect(result.technical_passed).toBe(false)
    expect(result.coverage.passed).toBe(false)
    expect(result.coverage.missing_captures).toEqual([
      { profile: 'mobile', name: 'more-menu-open', route: '/#mobile-more-open' },
    ])
  })

  it('keeps nested overflow candidates reviewable without treating them as page overflow', () => {
    const diagnostics = cleanDiagnostics()
    diagnostics[2].layout.overflowing_elements = [
      {
        tag: 'code',
        id: null,
        class_name: 'identifier',
        text: 'ABC',
        left: 0,
        right: 390,
        width: 390,
        right_overflow_px: 0,
        left_overflow_px: 0,
        internal_overflow_px: 40,
        overflow_x: 'hidden',
      },
    ]

    const result = evaluateAuditEvidence(manifest, diagnostics)

    expect(result.technical_passed).toBe(true)
    expect(result.page_horizontal_overflow_count).toBe(0)
    expect(result.overflow_review_candidate_route_count).toBe(1)
  })
})
