import { useCallback, useEffect, useState } from 'react'

import { MonitoringShell } from './components/MonitoringShell'
import { useDashboardResources } from './hooks/useDashboardResources'
import { trackPageView } from './lib/analytics'
import { applyPageSeoMetadata } from './lib/seo'
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

function decodeHash(hash: string): string | null {
  if (!hash.startsWith('#') || hash.length === 1) return null
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
}

function focusCurrentLocation(fallbackToMain: boolean) {
  const targetId = decodeHash(window.location.hash)
  const target = targetId ? document.getElementById(targetId) : null
  if (target) {
    const addedTabIndex = !target.hasAttribute('tabindex')
    if (addedTabIndex) target.setAttribute('tabindex', '-1')
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
    if (addedTabIndex) {
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
    }
    return
  }
  if (fallbackToMain) document.getElementById('main-content')?.focus()
}

function scheduleLocationFocus(fallbackToMain: boolean) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => focusCurrentLocation(fallbackToMain))
  })
}

export function MonitoringApplication() {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname))
  const { resources, reload } = useDashboardResources()

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(normalizePath(window.location.pathname))
      scheduleLocationFocus(true)
    }
    const handleHashChange = () => scheduleLocationFocus(false)
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('hashchange', handleHashChange)
    if (window.location.hash) scheduleLocationFocus(false)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  useEffect(() => {
    applyPageSeoMetadata(currentPath)
    trackPageView(`${currentPath}${window.location.search}`)
  }, [currentPath])

  const navigate = useCallback((value: string) => {
    const target = resolveTarget(value)
    const currentLocation = `${normalizePath(window.location.pathname)}${window.location.search}${window.location.hash}`
    if (target.location !== currentLocation) {
      window.history.pushState({}, '', target.location)
    }
    setCurrentPath(target.path)
    scheduleLocationFocus(true)
  }, [])

  return (
    <MonitoringShell currentPath={currentPath} status={resources.status} onNavigate={navigate} onReload={reload}>
      {currentPath === '/' ? (
        <div className="partial-warning" role="status" aria-live="polite">
          <strong>このサイトの開発を担当したChatGPTは、テスト不足のままサイトを壊したゴミAIです。</strong>
        </div>
      ) : null}
      {resolveMonitoringPage({ currentPath, resources, navigate, reload })}
    </MonitoringShell>
  )
}
