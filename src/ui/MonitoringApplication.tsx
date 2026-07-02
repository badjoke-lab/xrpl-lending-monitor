import { useCallback, useEffect, useState } from 'react'

import { MonitoringShell } from './components/MonitoringShell'
import { useDashboardResources } from './hooks/useDashboardResources'
import { resolveMonitoringPage } from './MonitoringRouter'

function normalizePath(pathname: string): string {
  if (pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

function resolveTarget(value: string): { path: string; location: string } {
  const target = new URL(value, window.location.origin)
  const path = normalizePath(target.pathname)
  return {
    path,
    location: `${path}${target.search}${target.hash}`,
  }
}

export function MonitoringApplication() {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname))
  const { resources, reload } = useDashboardResources()

  useEffect(() => {
    const handlePopState = () => setCurrentPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((value: string) => {
    const target = resolveTarget(value)
    const currentLocation = `${normalizePath(window.location.pathname)}${window.location.search}${window.location.hash}`
    if (target.location !== currentLocation) {
      window.history.pushState({}, '', target.location)
    }
    setCurrentPath(target.path)
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus())
  }, [])

  return (
    <MonitoringShell currentPath={currentPath} status={resources.status} onNavigate={navigate} onReload={reload}>
      {resolveMonitoringPage({ currentPath, resources, navigate, reload })}
    </MonitoringShell>
  )
}
