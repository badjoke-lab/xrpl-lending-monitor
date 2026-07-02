import { useCallback, useEffect, useState } from 'react'

import { MonitoringShell } from './components/MonitoringShell'
import { useDashboardResources } from './hooks/useDashboardResources'
import { resolveMonitoringPage } from './MonitoringRouter'

function normalizePath(pathname: string): string {
  if (pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

export function MonitoringApplication() {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname))
  const { resources, reload } = useDashboardResources()

  useEffect(() => {
    const handlePopState = () => setCurrentPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((path: string) => {
    const normalized = normalizePath(path)
    if (normalized !== normalizePath(window.location.pathname)) {
      window.history.pushState({}, '', normalized)
    }
    setCurrentPath(normalized)
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus())
  }, [])

  return (
    <MonitoringShell currentPath={currentPath} status={resources.status} onNavigate={navigate} onReload={reload}>
      {resolveMonitoringPage({ currentPath, resources, navigate, reload })}
    </MonitoringShell>
  )
}
