import type { ReactNode } from 'react'

import { AboutPage } from './pages/AboutPage'
import { AccountDetailPage } from './pages/AccountDetailPage'
import { ActivityPage } from './pages/ActivityPage'
import { ApiDocumentationPage } from './pages/ApiDocumentationPage'
import { ContactPage } from './pages/ContactPage'
import { LoanBrokerDetailPage } from './pages/LoanBrokerDetailPage'
import { LoanBrokersPage } from './pages/LoanBrokersPage'
import { LoanDetailPage } from './pages/LoanDetailPage'
import { LoansPage } from './pages/LoansPage'
import { LifecycleAuditPage } from './pages/LifecycleAuditPage'
import { MethodologyPage } from './pages/MethodologyPage'
import { NetworkStatusPage } from './pages/NetworkStatusPage'
import { OverviewPage } from './pages/OverviewPage'
import { SearchPage } from './pages/SearchPage'
import { TransactionDetailPage } from './pages/TransactionDetailPage'
import { VaultDetailPage } from './pages/VaultDetailPage'
import { VaultsPage } from './pages/VaultsPage'
import type { DashboardResources } from './types/api'

interface RouteContext {
  currentPath: string
  resources: DashboardResources
  navigate: (path: string) => void
  reload: () => void
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Navigation</p>
          <h1>Page not found</h1>
          <p className="page-summary">This route is not part of the currently implemented monitoring surface.</p>
        </div>
      </header>
      <div className="state-block state-unavailable" role="status">
        <span className="state-symbol" aria-hidden="true">404</span>
        <div>
          <strong>Unknown route</strong>
          <p>Return to the Overview or use the available navigation items.</p>
          <button className="secondary-button" type="button" onClick={() => onNavigate('/')}>Go to Overview</button>
        </div>
      </div>
    </div>
  )
}

export function resolveMonitoringPage({ currentPath, resources, navigate, reload }: RouteContext): ReactNode {
  const vault = /^\/vaults\/([A-Fa-f0-9]{64})$/.exec(currentPath)
  const broker = /^\/loan-brokers\/([A-Fa-f0-9]{64})$/.exec(currentPath)
  const loan = /^\/loans\/([A-Fa-f0-9]{64})$/.exec(currentPath)
  const transaction = /^\/transactions\/([^/]+)$/.exec(currentPath)
  const account = /^\/accounts\/([^/]+)$/.exec(currentPath)

  if (currentPath === '/') return <OverviewPage resources={resources} onNavigate={navigate} onReload={reload} />
  if (currentPath === '/network-status') return <NetworkStatusPage status={resources.status} onReload={reload} />
  if (currentPath === '/vaults') return <VaultsPage onNavigate={navigate} />
  if (vault?.[1]) return <VaultDetailPage vaultId={vault[1].toUpperCase()} onNavigate={navigate} />
  if (currentPath === '/loan-brokers') return <LoanBrokersPage onNavigate={navigate} />
  if (broker?.[1]) return <LoanBrokerDetailPage brokerId={broker[1].toUpperCase()} onNavigate={navigate} />
  if (currentPath === '/loans') return <LoansPage onNavigate={navigate} />
  if (loan?.[1]) return <LoanDetailPage loanId={loan[1].toUpperCase()} onNavigate={navigate} />
  if (currentPath === '/activity') return <ActivityPage onNavigate={navigate} />
  if (currentPath === '/audit/lifecycle') return <LifecycleAuditPage onNavigate={navigate} />
  if (transaction?.[1]) return <TransactionDetailPage transactionHash={transaction[1]} onNavigate={navigate} />
  if (currentPath === '/search') return <SearchPage onNavigate={navigate} />
  if (account?.[1]) {
    const decodedAccount = safeDecode(account[1])
    if (decodedAccount !== null) return <AccountDetailPage account={decodedAccount} onNavigate={navigate} />
  }
  if (currentPath === '/api') return <ApiDocumentationPage onNavigate={navigate} />
  if (currentPath === '/methodology') return <MethodologyPage onNavigate={navigate} />
  if (currentPath === '/about') return <AboutPage onNavigate={navigate} />
  if (currentPath === '/contact') return <ContactPage onNavigate={navigate} />
  return <NotFoundPage onNavigate={navigate} />
}
