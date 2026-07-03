import { describe, expect, it } from 'vitest'

import { resolveBreadcrumbs } from './Breadcrumbs'

describe('resolveBreadcrumbs', () => {
  it('keeps top-level routes under Overview', () => {
    expect(resolveBreadcrumbs('/methodology')).toEqual([
      { label: 'Overview', path: '/' },
      { label: 'Methodology' },
    ])
  })

  it('keeps transaction detail under Activity and preserves the full identifier as a title', () => {
    const hash = 'A'.repeat(64)
    const breadcrumbs = resolveBreadcrumbs(`/transactions/${hash}`)

    expect(breadcrumbs.slice(0, 2)).toEqual([
      { label: 'Overview', path: '/' },
      { label: 'Activity', path: '/activity' },
    ])
    expect(breadcrumbs[2]?.label).toBe('Transaction AAAAAAAAAA…AAAAAAAA')
    expect(breadcrumbs[2]?.title).toBe(hash)
  })

  it('decodes account identifiers without inventing an identity label', () => {
    const account = 'rExample%2FRelationship'
    const breadcrumbs = resolveBreadcrumbs(`/accounts/${account}`)

    expect(breadcrumbs[1]).toEqual({ label: 'Search', path: '/search' })
    expect(breadcrumbs[2]?.title).toBe('rExample/Relationship')
  })

  it('places archived object details under the Archived Objects audit route', () => {
    const objectId = 'B'.repeat(64)
    const breadcrumbs = resolveBreadcrumbs(`/audit/archived/Loan/${objectId}`)

    expect(breadcrumbs.slice(0, 2)).toEqual([
      { label: 'Overview', path: '/' },
      { label: 'Archived Objects', path: '/audit/archived' },
    ])
    expect(breadcrumbs[2]?.label).toBe('Loan BBBBBBBBBB…BBBBBBBB')
    expect(breadcrumbs[2]?.title).toBe(objectId)
  })

  it('labels the cover and loss audit route', () => {
    expect(resolveBreadcrumbs('/audit/cover-loss')).toEqual([
      { label: 'Overview', path: '/' },
      { label: 'Cover & Loss' },
    ])
  })

  it('labels unsupported routes without adding a false hierarchy', () => {
    expect(resolveBreadcrumbs('/unsupported')).toEqual([
      { label: 'Overview', path: '/' },
      { label: 'Page not found' },
    ])
  })
})
