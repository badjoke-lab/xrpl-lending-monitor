import { rewriteR5CollectorContentionResponse } from './r5-collector-contention-retry.mjs'

const originalFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init)
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
  return rewriteR5CollectorContentionResponse(url, response)
}

try {
  await import('./run-supabase-r5-recovery-burst-adoption-aware.mjs')
} finally {
  globalThis.fetch = originalFetch
}
