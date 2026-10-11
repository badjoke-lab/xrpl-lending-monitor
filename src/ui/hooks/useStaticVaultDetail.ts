import { useEffect, useState } from 'react'

import {
  loadStaticVaultDetail,
  type StaticVaultDetailRead,
} from '../lib/staticVaultDetail'
import type { ResourceState } from '../types/api'

export function useStaticVaultDetail(vaultId: string) {
  const [resource, setResource] = useState<ResourceState<StaticVaultDetailRead>>({
    state: 'loading',
    data: null,
    error: null,
  })
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let active = true
    setResource({ state: 'loading', data: null, error: null })
    void loadStaticVaultDetail(vaultId)
      .then((data) => {
        if (active) setResource({ state: 'ready', data, error: null })
      })
      .catch((error: unknown) => {
        if (!active) return
        setResource({
          state: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'Static Current is unavailable',
        })
      })
    return () => { active = false }
  }, [vaultId, refreshToken])

  return {
    resource,
    reload: () => setRefreshToken((previous) => previous + 1),
  }
}
