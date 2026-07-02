import { useEffect, useState } from 'react'

import type { ResourceState } from '../types/api'

export function useApiResource<T>(url: string | null) {
  const [resource, setResource] = useState<ResourceState<T>>({
    state: 'loading',
    data: null,
    error: null,
  })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    setResource({ state: 'loading', data: null, error: null })

    void fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { message?: string } | null
          throw new Error(body?.message ?? `${url} returned HTTP ${response.status}`)
        }
        return response.json() as Promise<T>
      })
      .then((data) => {
        setResource({ state: 'ready', data, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setResource({
          state: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'The API request failed',
        })
      })

    return () => controller.abort()
  }, [url, reloadToken])

  return {
    resource,
    reload: () => setReloadToken((value) => value + 1),
  }
}
