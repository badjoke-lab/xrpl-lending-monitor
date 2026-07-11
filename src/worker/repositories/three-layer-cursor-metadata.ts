function decodeBase64UrlText(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function decodeHexText(value: string): string {
  if (value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) throw new Error('invalid hex cursor')
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

function objectScope(value: string, field: 'q' | 'scope'): string | null {
  const parsed = JSON.parse(value) as Record<string, unknown>
  return typeof parsed[field] === 'string' ? parsed[field] : null
}

export function readThreeLayerCursorScope(value: string | undefined): string | null {
  if (!value) return null
  try {
    const scope = objectScope(decodeBase64UrlText(value), 'q')
    if (scope !== null) return scope
  } catch {
    // Try the legacy raw canonical cursor below.
  }
  try {
    return objectScope(decodeHexText(value), 'scope')
  } catch {
    return null
  }
}
