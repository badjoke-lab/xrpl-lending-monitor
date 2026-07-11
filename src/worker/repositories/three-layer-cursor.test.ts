import { describe, expect, it } from 'vitest'

import type { BaseOverlayListOptions } from './base-overlay-current-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  encodeThreeLayerCursor,
  readThreeLayerCursor,
  type ThreeLayerCursorState,
} from './three-layer-cursor'

const snapshot: ActiveSnapshotRecord = {
  id: 'devnet-3540657-de23e44e0906',
  epochId: 'devnet-3371675',
  ledgerIndex: 3540657,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'B'.repeat(64),
  vaultCount: 10,
  loanBrokerCount: 10,
  loanCount: 10,
  objectCount: 30,
  shardCount: 3,
  compressedBytes: 0,
  completedAt: '2026-07-11T00:00:00.000Z',
}

const list: BaseOverlayListOptions = {
  limit: 25,
  direction: 'asc',
  scope: 'loan:id_asc::active:current:836000000',
}

function hexUtf8(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

function textFromHex(value: string): string {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function readModelCursor(): string {
  return hexUtf8(JSON.stringify({
    v: 1,
    snapshot: snapshot.id,
    kind: 'loan',
    direction: 'asc',
    scope: list.scope,
    page: 123,
    offset: 45,
  }))
}

function canonicalCursor(): string {
  return hexUtf8(JSON.stringify({
    v: 1,
    snapshot: snapshot.id,
    kind: 'loan',
    direction: 'asc',
    scope: list.scope,
    baseCursor: readModelCursor(),
    baseOffset: 0,
    baseDone: false,
    overlayAfter: 'D'.repeat(64),
    overlayOffset: 12,
    overlayDone: false,
  }))
}

function cursor(): ThreeLayerCursorState {
  return {
    v: 1,
    snapshot: snapshot.id,
    kind: 'loan',
    direction: 'asc',
    scope: list.scope,
    canonicalCursor: canonicalCursor(),
    canonicalOffset: 37,
    canonicalDone: false,
    fastAfter: 'C'.repeat(64),
    fastOffset: 22,
    fastDone: false,
    fastToken: 'fast-lane-shadow-devnet:2026-07-11T05:00:00.000Z',
  }
}

function legacyCursor(state: ThreeLayerCursorState): string {
  return encodeBase64Url(JSON.stringify({
    v: 1,
    s: state.snapshot,
    k: state.kind,
    d: state.direction === 'asc' ? 'a' : 'z',
    q: state.scope,
    c: `j${textFromHex(state.canonicalCursor!)}`,
    o: state.canonicalOffset,
    x: state.canonicalDone,
    f: state.fastAfter,
    p: state.fastOffset,
    y: state.fastDone,
    t: state.fastToken,
  }))
}

describe('three-layer cursor', () => {
  it('round-trips a real nested canonical and base cursor below the public length guard', () => {
    const value = encodeThreeLayerCursor(cursor())
    expect(value.length).toBeLessThanOrEqual(1024)
    expect(readThreeLayerCursor({
      value,
      snapshot,
      kind: 'loan',
      list,
      fastToken: cursor().fastToken,
    })).toEqual(cursor())
  })

  it('continues to decode the previous one-level compact cursor format', () => {
    expect(readThreeLayerCursor({
      value: legacyCursor(cursor()),
      snapshot,
      kind: 'loan',
      list,
      fastToken: cursor().fastToken,
    })).toEqual(cursor())
  })

  it('rejects a changed fast-lane binding token during pagination', () => {
    const value = encodeThreeLayerCursor(cursor())
    expect(() => readThreeLayerCursor({
      value,
      snapshot,
      kind: 'loan',
      list,
      fastToken: 'different-binding',
    })).toThrow('fast-lane read context changed during pagination')
  })
})
