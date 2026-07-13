import { describe, expect, it } from 'vitest'

import {
  booleanLabel,
  formatDuration,
  formatInteger,
  formatUtc,
  statusTone,
  titleCase,
  truncateMiddle,
} from './formatting'

describe('UI formatting helpers', () => {
  it('keeps unavailable values explicit', () => {
    expect(formatInteger(null)).toBe('Unavailable')
    expect(formatDuration(null)).toBe('Unavailable')
    expect(formatUtc(null)).toBe('Unavailable')
  })

  it('formats integers and durations', () => {
    expect(formatInteger(5432109)).toBe('5,432,109')
    expect(formatDuration(42)).toBe('42s')
    expect(formatDuration(125)).toBe('2m 5s')
    expect(formatDuration(7380)).toBe('2h 3m')
  })

  it('formats UTC timestamps and rejects invalid timestamps', () => {
    expect(formatUtc('2026-07-02T01:02:03.000Z')).toContain('UTC')
    expect(formatUtc('invalid')).toBe('Unavailable')
  })

  it('truncates only long identifiers', () => {
    expect(truncateMiddle('ABCDEF', 4)).toBe('ABCDEF')
    expect(truncateMiddle('1234567890ABCDEFGHIJ', 4)).toBe('1234…GHIJ')
  })

  it('maps statuses to semantic tones', () => {
    expect(statusTone('healthy')).toBe('positive')
    expect(statusTone('tesSUCCESS')).toBe('positive')
    expect(statusTone('stale')).toBe('warning')
    expect(statusTone('error')).toBe('negative')
    expect(statusTone('uninitialized')).toBe('neutral')
  })

  it('keeps nullable booleans and labels explicit', () => {
    expect(booleanLabel(null)).toBe('Unavailable')
    expect(booleanLabel(true)).toBe('Yes')
    expect(booleanLabel(false)).toBe('No')
    expect(titleCase('default_eligible')).toBe('Default Eligible')
  })

  it('preserves XRPL mixed-case identifiers', () => {
    expect(titleCase('LoanBrokerSet')).toBe('LoanBrokerSet')
    expect(titleCase('VaultCreate')).toBe('VaultCreate')
    expect(titleCase('tesSUCCESS')).toBe('tesSUCCESS')
  })
})
