import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { BaseOverlayListOptions } from './base-overlay-current-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'

export interface ThreeLayerCursorState {
  v: 1
  snapshot: string
  kind: ReadModelKind
  direction: 'asc' | 'desc'
  scope: string
  canonicalCursor: string | null
  canonicalOffset: number
  canonicalDone: boolean
  fastAfter: string | null
  fastOffset: number
  fastDone: boolean
  fastToken: string | null
}

interface CompactCursor {
  v: 1
  s: string
  k: ReadModelKind
  d: 'a' | 'z'
  q: string
  c: string | null
  o: number
  x: boolean
  f: string | null
  p: number
  y: boolean
  t: string | null
}

interface CanonicalCursorContext {
  snapshot: string
  kind: ReadModelKind
  direction: 'asc' | 'desc'
  scope: string
}

interface CanonicalCursorPayload extends CanonicalCursorContext {
  v: 1
  baseCursor: string | null
  baseOffset: number
  baseDone: boolean
  overlayAfter: string | null
  overlayOffset: number
  overlayDone: boolean
}

interface CompactCanonicalCursor {
  v: 1
  b: string | null
  o: number
  x: boolean
  a: string | null
  p: number
  y: boolean
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeText(value: string): string {
  return encodeBytes(new TextEncoder().encode(value))
}

function decodeText(value: string): string {
  return new TextDecoder().decode(decodeBytes(value))
}

function hexToText(value: string): string {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function textToHex(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

function compactNestedCursor(value: string | null): string | null {
  if (value === null) return null
  if (value.length % 2 === 0 && /^[a-f0-9]+$/i.test(value)) {
    try {
      return `j${hexToText(value)}`
    } catch {
      // Preserve unusual non-UTF-8 cursors through the generic representation.
    }
  }
  return `u${value}`
}

function expandNestedCursor(value: string | null): string | null {
  if (value === null) return null
  if (value.startsWith('j')) return textToHex(value.slice(1))
  if (value.startsWith('u')) return value.slice(1)
  throw new Error('invalid nested cursor encoding')
}

function canonicalPayload(
  value: string,
  context: CanonicalCursorContext,
): CanonicalCursorPayload | null {
  try {
    const source = JSON.parse(value) as Partial<CanonicalCursorPayload>
    if (
      source.v !== 1
      || source.snapshot !== context.snapshot
      || source.kind !== context.kind
      || source.direction !== context.direction
      || source.scope !== context.scope
      || (source.baseCursor !== null && typeof source.baseCursor !== 'string')
      || !Number.isSafeInteger(source.baseOffset)
      || Number(source.baseOffset) < 0
      || typeof source.baseDone !== 'boolean'
      || (source.overlayAfter !== null && typeof source.overlayAfter !== 'string')
      || !Number.isSafeInteger(source.overlayOffset)
      || Number(source.overlayOffset) < 0
      || typeof source.overlayDone !== 'boolean'
    ) return null
    return source as CanonicalCursorPayload
  } catch {
    return null
  }
}

function compactCanonicalCursor(
  value: string | null,
  context: CanonicalCursorContext,
): string | null {
  if (value === null) return null
  if (value.length % 2 === 0 && /^[a-f0-9]+$/i.test(value)) {
    try {
      const text = hexToText(value)
      const payload = canonicalPayload(text, context)
      if (payload) {
        const compact: CompactCanonicalCursor = {
          v: 1,
          b: compactNestedCursor(payload.baseCursor),
          o: payload.baseOffset,
          x: payload.baseDone,
          a: payload.overlayAfter,
          p: payload.overlayOffset,
          y: payload.overlayDone,
        }
        return `h${JSON.stringify(compact)}`
      }
      return `j${text}`
    } catch {
      // Preserve unusual non-UTF-8 cursors through the generic representation.
    }
  }
  return `u${value}`
}

function expandCanonicalCursor(
  value: string | null,
  context: CanonicalCursorContext,
): string | null {
  if (value === null) return null
  if (value.startsWith('h')) {
    const compact = JSON.parse(value.slice(1)) as Partial<CompactCanonicalCursor>
    if (
      compact.v !== 1
      || (compact.b !== null && typeof compact.b !== 'string')
      || !Number.isSafeInteger(compact.o)
      || Number(compact.o) < 0
      || typeof compact.x !== 'boolean'
      || (compact.a !== null && typeof compact.a !== 'string')
      || !Number.isSafeInteger(compact.p)
      || Number(compact.p) < 0
      || typeof compact.y !== 'boolean'
    ) throw new Error('invalid compact canonical cursor')
    const payload: CanonicalCursorPayload = {
      v: 1,
      ...context,
      baseCursor: expandNestedCursor(compact.b),
      baseOffset: Number(compact.o),
      baseDone: compact.x,
      overlayAfter: compact.a,
      overlayOffset: Number(compact.p),
      overlayDone: compact.y,
    }
    return textToHex(JSON.stringify(payload))
  }
  if (value.startsWith('j')) return textToHex(value.slice(1))
  if (value.startsWith('u')) return value.slice(1)
  throw new Error('invalid canonical cursor encoding')
}

function initialCursor(options: {
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
  fastToken: string | null
}): ThreeLayerCursorState {
  return {
    v: 1,
    snapshot: options.snapshot.id,
    kind: options.kind,
    direction: options.list.direction,
    scope: options.list.scope,
    canonicalCursor: null,
    canonicalOffset: 0,
    canonicalDone: false,
    fastAfter: null,
    fastOffset: 0,
    fastDone: options.fastToken === null,
    fastToken: options.fastToken,
  }
}

export function encodeThreeLayerCursor(cursor: ThreeLayerCursorState): string {
  const compact: CompactCursor = {
    v: 1,
    s: cursor.snapshot,
    k: cursor.kind,
    d: cursor.direction === 'asc' ? 'a' : 'z',
    q: cursor.scope,
    c: compactCanonicalCursor(cursor.canonicalCursor, cursor),
    o: cursor.canonicalOffset,
    x: cursor.canonicalDone,
    f: cursor.fastAfter,
    p: cursor.fastOffset,
    y: cursor.fastDone,
    t: cursor.fastToken,
  }
  return encodeText(JSON.stringify(compact))
}

export function readThreeLayerCursor(options: {
  value: string | undefined
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
  fastToken: string | null
}): ThreeLayerCursorState {
  if (!options.value) return initialCursor(options)
  try {
    const compact = JSON.parse(decodeText(options.value)) as Partial<CompactCursor>
    if (
      compact.v !== 1
      || compact.s !== options.snapshot.id
      || compact.k !== options.kind
      || compact.d !== (options.list.direction === 'asc' ? 'a' : 'z')
      || compact.q !== options.list.scope
      || (compact.c !== null && typeof compact.c !== 'string')
      || !Number.isSafeInteger(compact.o)
      || Number(compact.o) < 0
      || typeof compact.x !== 'boolean'
      || (compact.f !== null && typeof compact.f !== 'string')
      || !Number.isSafeInteger(compact.p)
      || Number(compact.p) < 0
      || typeof compact.y !== 'boolean'
      || (compact.t !== null && typeof compact.t !== 'string')
    ) throw new Error('invalid')
    if (compact.t !== null && compact.t !== options.fastToken) {
      throw new CurrentStateObjectReadError(
        'manifest_integrity_error',
        'fast-lane read context changed during pagination',
      )
    }
    const context: CanonicalCursorContext = {
      snapshot: compact.s,
      kind: compact.k,
      direction: compact.d === 'a' ? 'asc' : 'desc',
      scope: compact.q,
    }
    return {
      v: 1,
      ...context,
      canonicalCursor: expandCanonicalCursor(compact.c, context),
      canonicalOffset: Number(compact.o),
      canonicalDone: compact.x,
      fastAfter: compact.f,
      fastOffset: Number(compact.p),
      fastDone: compact.y,
      fastToken: compact.t,
    }
  } catch (error) {
    if (error instanceof CurrentStateObjectReadError) throw error
    return {
      ...initialCursor({ ...options, fastToken: null }),
      canonicalCursor: options.value,
      fastDone: true,
    }
  }
}
