import { useCallback, useEffect, useState } from 'react'

import { AppShell } from './components/AppShell'
import { useDashboardResources } from './hooks/useDashboardResources'
import { LoanBrokerDetailPage } from './pages/LoanBrokerDetailPage'
import { LoanBrokersPage } from './pages/LoanBrokersPage'
import { NetworkStatusPage } from './pages/NetworkStatusPage'
import { OverviewPage } from './pages/OverviewPage'
import { VaultDetailPage } from './pages/VaultDetailPage'
import { VaultsPage } from './pages/VaultsPage'

function normalizePath(pathname: string): string {
  if (pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Navigation</p>
          <h1>Page not found</h1>
          <p className="page-summary">
            This route is not part of the currently implemented monitoring surface.
          </p>
        </div>
      </header>
      <div className="state-block state-unavailable" role="status">
        <span className="state-symbol" aria-hidden="true">404</span>
        <div>
          <strong>Unknown route</strong>
          <p>Return to the Overview or use the available navigation items.</p>
          <button className="secondary-button" type="button" onClick={() => onNavigate('/')}>
            Go to Overview
          </button>
        </div>
      </div>
    </div>
  )
}

export function App() {
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

  const vaultDetailMatch = /^\/vaults\/([A-Fa-f0-9]{64})$/.exec(currentPath)
  const brokerDetailMatch = /^\/loan-brokers\/([A-Fa-f0-9]{64})$/.exec(currentPath)
  let page
  if (currentPath === '/') {
    page = <OverviewPage resources={resources} onNavigate={navigate} onReload={reload} />
  } else if (currentPath === '/network-status') {
    page = <NetworkStatusPage status={resources.status} onReload={reload} />
  } else if (currentPath === '/vaults') {
    page = <VaultsPage onNavigate={navigate} />
  } else if (vaultDetailMatch?.[1]) {
    page = <VaultDetailPage vaultId={vaultDetailMatch[1].toUpperCase()} onNavigate={navigate} />
  } else if (currentPath === '/loan-brokers') {
    page = <LoanBrokersPage onNavigate={navigate} />
  } else if (brokerDetailMatch?.[1]) {
    page = (
      <LoanBrokerDetailPage
        brokerId={brokerDetailMatch[1].toUpperCase()}
        onNavigate={navigate}
      />
    )
  } else {
    page = <NotFoundPage onNavigate={navigate} />
  }

  return (
    <AppShell
      currentPath={currentPath}
      status={resources.status}
      onNavigate={navigate}
      onReload={reload}
    >
      {page}
    </AppShell>
  )
}
