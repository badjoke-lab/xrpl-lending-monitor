import { describe, expect, it } from 'vitest'

import { mergeHistorySources } from './merge-sources'

interface Row {
  id: string
  ledger: number
  order: number
}

const desc = (left: Row, right: Row) =>
  right.ledger - left.ledger || right.order - left.order || left.id.localeCompare(right.id)

const asc = (left: Row, right: Row) =>
  left.ledger - right.ledger || left.order - right.order || left.id.localeCompare(right.id)

const base = {
  boundaryLedgerIndex: 105,
  ledgerIndex: (row: Row) => row.ledger,
  identity: (row: Row) => row.id,
}

describe('history source merge semantics', () => {
  it('merges immutable and later live rows in descending order', () => {
    const result = mergeHistorySources({
      ...base,
      immutable: [
        { id: 'i-105', ledger: 105, order: 1 },
        { id: 'i-104', ledger: 104, order: 1 },
      ],
      live: [
        { id: 'l-107', ledger: 107, order: 1 },
        { id: 'l-106', ledger: 106, order: 1 },
      ],
      compare: desc,
      limit: 10,
    })
    expect(result.items.map((row) => row.id)).toEqual(['l-107', 'l-106', 'i-105', 'i-104'])
  })

  it('merges lifecycle-style rows in ascending order', () => {
    const result = mergeHistorySources({
      ...base,
      immutable: [
        { id: 'i-101', ledger: 101, order: 1 },
        { id: 'i-105', ledger: 105, order: 1 },
      ],
      live: [
        { id: 'l-106', ledger: 106, order: 1 },
        { id: 'l-108', ledger: 108, order: 1 },
      ],
      compare: asc,
      limit: 10,
    })
    expect(result.items.map((row) => row.id)).toEqual(['i-101', 'i-105', 'l-106', 'l-108'])
  })

  it('suppresses live rows at or before the immutable publication boundary', () => {
    const result = mergeHistorySources({
      ...base,
      immutable: [{ id: 'i-105', ledger: 105, order: 1 }],
      live: [
        { id: 'overlap-104', ledger: 104, order: 1 },
        { id: 'overlap-105', ledger: 105, order: 1 },
        { id: 'live-106', ledger: 106, order: 1 },
      ],
      compare: desc,
      limit: 10,
    })
    expect(result.items.map((row) => row.id)).toEqual(['live-106', 'i-105'])
    expect(result.diagnostics.liveSuppressedAtBoundary).toBe(2)
    expect(result.diagnostics.liveAccepted).toBe(1)
  })

  it('suppresses duplicate identities defensively', () => {
    const result = mergeHistorySources({
      ...base,
      immutable: [
        { id: 'same', ledger: 105, order: 1 },
        { id: 'same', ledger: 104, order: 1 },
      ],
      live: [],
      compare: desc,
      limit: 10,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.ledger).toBe(105)
    expect(result.diagnostics.duplicatesSuppressed).toBe(1)
  })

  it('uses the supplied complete comparator for stable tie-breaking', () => {
    const result = mergeHistorySources({
      ...base,
      immutable: [
        { id: 'b', ledger: 105, order: 2 },
        { id: 'a', ledger: 105, order: 2 },
        { id: 'c', ledger: 105, order: 1 },
      ],
      live: [],
      compare: desc,
      limit: 10,
    })
    expect(result.items.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('truncates after deterministic merge and duplicate suppression', () => {
    const result = mergeHistorySources({
      ...base,
      immutable: [
        { id: 'i-105', ledger: 105, order: 1 },
        { id: 'i-104', ledger: 104, order: 1 },
      ],
      live: [
        { id: 'l-107', ledger: 107, order: 1 },
        { id: 'l-106', ledger: 106, order: 1 },
      ],
      compare: desc,
      limit: 2,
    })
    expect(result.items.map((row) => row.id)).toEqual(['l-107', 'l-106'])
  })

  it('fails closed if immutable history exceeds the publication boundary', () => {
    expect(() => mergeHistorySources({
      ...base,
      immutable: [{ id: 'bad', ledger: 106, order: 1 }],
      live: [],
      compare: desc,
      limit: 10,
    })).toThrow('exceeds the verified publication boundary')
  })
})
