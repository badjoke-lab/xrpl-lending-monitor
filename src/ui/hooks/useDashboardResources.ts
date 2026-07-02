import { useCallback, useEffect, useState } from 'react'

import type {
  ActivityResponse,
  DashboardResources,
  NetworkStatusResponse,
  OverviewResponse,
  ResourceState,
} from '../types/api'

const loadingState = <T,>(): ResourceState<T> => ({ state: 'loading', data: null, error: null })

const initialResources: DashboardResources = {
  status: loadingState<NetworkStatusResponse>(),
  overview: loadingState<OverviewResponse>(),
  activity: loadingState<ActivityResponse>(),
}

async function requestJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

function publicError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Request cancelled'
  if (error instanceof Error) return error.message
  return 'The API request failed'
}

export function useDashboardResources() {
  const [resources, setResources] = useState<DashboardResources>(initialResources)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setResources(initialResources)

    const load = async <K extends keyof DashboardResources>(
      key: K,
      request: Promise<DashboardResources[K] extends ResourceState<infer T> ? T : never>,
    ) => {
      try {
        const data = await request
        setResources((current) => ({
          ...current,
          [key]: { state: 'ready', data, error: null },
        }))
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        setResources((current) => ({
          ...current,
          [key]: { state: 'error', data: null, error: publicError(error) },
        }))
      }
    }

    void load('status', requestJson<NetworkStatusResponse>('/api/status', controller.signal))
    void load('overview', requestJson<OverviewResponse>('/api/overview', controller.signal))
    void load('activity', requestJson<ActivityResponse>('/api/activity?limit=6', controller.signal))

    return () => controller.abort()
  }, [reloadToken])

  return { resources, reload }
}
