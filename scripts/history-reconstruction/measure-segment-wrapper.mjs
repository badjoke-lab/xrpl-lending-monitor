import { writeFile } from 'node:fs/promises'

const originalFetch = globalThis.fetch
const metrics = { requests: 0, retries: 0, timeouts: 0, errors: 0, responseClasses: {} }
const requestBodies = new Set()
globalThis.fetch = async (...args) => {
  metrics.requests += 1
  const body = typeof args[1]?.body === 'string' ? args[1].body : null
  if (body !== null) {
    if (requestBodies.has(body)) metrics.retries += 1
    requestBodies.add(body)
  }
  try {
    const response = await originalFetch(...args)
    const responseClass = `${Math.floor(response.status / 100)}xx`
    metrics.responseClasses[responseClass] = (metrics.responseClasses[responseClass] ?? 0) + 1
    if (!response.ok) metrics.errors += 1
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') metrics.timeouts += 1
    else metrics.errors += 1
    throw error
  }
}

let written = false
async function persist() {
  if (written || !process.env.MEASUREMENT_FETCH_METRICS) return
  written = true
  await writeFile(process.env.MEASUREMENT_FETCH_METRICS, `${JSON.stringify(metrics, null, 2)}\n`)
}
try {
  await import('../../.history-segment-build/run-history-segment.mjs')
} finally {
  await persist()
}
