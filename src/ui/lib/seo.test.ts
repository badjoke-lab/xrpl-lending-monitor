import { describe, expect, it } from 'vitest'

import { normalizePublicSiteOrigin, resolvePageSeoMetadata } from './seo'

describe('resolvePageSeoMetadata', () => {
  it('returns indexable metadata for public static routes', () => {
    expect(resolvePageSeoMetadata('/audit/lifecycle')).toEqual({
      title: 'Loan Lifecycle Audit | XRPL Lending Monitor',
      description:
        'Explore indexed XRPL Lending Loan lifecycle events, payments, state transitions, source transactions, and provenance.',
      robots: 'index,follow',
      canonicalPath: '/audit/lifecycle',
    })
  })

  it('keeps volatile detail routes followable but out of the index', () => {
    const metadata = resolvePageSeoMetadata(`/loans/${'A'.repeat(64)}`)
    expect(metadata.title).toBe('Loan Detail | XRPL Lending Monitor')
    expect(metadata.robots).toBe('noindex,follow')
    expect(metadata.canonicalPath).toBe(`/loans/${'A'.repeat(64)}`)
  })

  it('fails unknown routes closed for indexing', () => {
    expect(resolvePageSeoMetadata('/not-a-route')).toMatchObject({
      title: 'Page Not Found | XRPL Lending Monitor',
      robots: 'noindex,nofollow',
      canonicalPath: null,
    })
  })
})

describe('normalizePublicSiteOrigin', () => {
  it('normalizes an explicitly configured public host', () => {
    expect(normalizePublicSiteOrigin('https://lending.example.com/path?q=1#hash')).toBe(
      'https://lending.example.com',
    )
  })

  it('does not invent a host when configuration is absent or invalid', () => {
    expect(normalizePublicSiteOrigin(undefined)).toBeNull()
    expect(normalizePublicSiteOrigin('not-a-url')).toBeNull()
    expect(normalizePublicSiteOrigin('ftp://example.com')).toBeNull()
  })
})
