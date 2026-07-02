import type { ReactNode } from 'react'

import { formatDuration, formatInteger, statusTone, titleCase } from '../lib/formatting'
import type { NetworkStatusResponse, ResourceState } from '../types/api'

interface AppShellProps {
  children: ReactNode
  currentPath: string
  status: ResourceState<NetworkStatusResponse>
  onNavigate: (path: string) => void
  onReload: () => void
}

interface NavigationItem {
  label: string
  path?: string
}

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: 'Monitor',
    items: [
      { label: 'Overview', path: '/' },
      { label: 'Vaults', path: '/vaults' },
      { label: 'Loan Brokers' },
      { label: 'Loans' },
      { label: 'Activity' },
      { label: 'Search' },
    ],
  },
  {
    label: 'Audit',
    items: [
      { label: 'Lifecycle' },
      { label: 'Archived Objects' },
      { label: 'Cover & Loss' },
      { label: 'Devnet Epochs' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Network Status', path: '/network-status' },
      { label: 'API' },
      { label: 'Methodology' },
    ],
  },
  {
    label: 'Project',
    items: [{ label: 'About' }, { label: 'Contact' }],
  },
]

function NavigationLink({
  item,
  currentPath,
  onNavigate,
}: {
  item: NavigationItem
  currentPath: string
  onNavigate: (path: string) => void
}) {
  if (!item.path) {
    return (
      <span className="nav-item nav-item-planned" aria-disabled="true">
        <span>{item.label}</span>
        <small>Planned</small>
      </span>
    )
  }

  const active = currentPath === item.path || (item.path !== '/' && currentPath.startsWith(`${item.path}/`))
  return (
    <a
      className={`nav-item${active ? ' is-active' : ''}`}
      href={item.path}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault()
        onNavigate(item.path ?? '/')
      }}
    >
      <span>{item.label}</span>
    </a>
  )
}

function Navigation({
  currentPath,
  onNavigate,
}: {
  currentPath: string
  onNavigate: (path: string) => void
}) {
  return (
    <nav aria-label="Primary navigation" className="primary-navigation">
      {navigationGroups.map((group) => (
        <section className="nav-group" key={group.label} aria-labelledby={`nav-${group.label}`}>
          <h2 id={`nav-${group.label}`}>{group.label}</h2>
          <div className="nav-list">
            {group.items.map((item) => (
              <NavigationLink
                item={item}
                currentPath={currentPath}
                onNavigate={onNavigate}
                key={item.label}
              />
            ))}
          </div>
        </section>
      ))}
    </nav>
  )
}

function ContextBar({ status }: { status: ResourceState<NetworkStatusResponse> }) {
  const data = status.state === 'ready' ? status.data : null
  const collectorLabel =
    status.state === 'loading'
      ? 'Loading'
      : status.state === 'error'
        ? 'Unavailable'
        : titleCase(data?.collector.status ?? 'Unavailable')
  const tone = status.state === 'error' ? 'negative' : statusTone(data?.collector.status)

  return (
    <section className="network-context" aria-label="Network context" aria-live="polite">
      <div className="context-network">
        <span className="network-badge">DEVNET</span>
        <span className="read-only-label">Read-only</span>
      </div>
      <dl className="context-facts">
        <div>
          <dt>Epoch</dt>
          <dd>{status.state === 'loading' ? 'Loading' : data?.epoch?.id ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Validated ledger</dt>
          <dd>{status.state === 'loading' ? 'Loading' : formatInteger(data?.server.latest_validated_ledger)}</dd>
        </div>
        <div>
          <dt>Data age</dt>
          <dd>{status.state === 'loading' ? 'Loading' : formatDuration(data?.collector.data_age_seconds)}</dd>
        </div>
        <div>
          <dt>Collector</dt>
          <dd>
            <span className={`status-dot status-${tone}`} aria-hidden="true" />
            {collectorLabel}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export function AppShell({ children, currentPath, status, onNavigate, onReload }: AppShellProps) {
  return (
    <div className="application-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate('/') }}>
          <span className="brand-mark" aria-hidden="true">XL</span>
          <span><strong>XRPL Lending Monitor</strong><small>Devnet observatory</small></span>
        </a>
        <Navigation currentPath={currentPath} onNavigate={onNavigate} />
        <div className="sidebar-footer"><p>Independent · read-only</p><a href="https://github.com/badjoke-lab/xrpl-lending-monitor">Repository</a></div>
      </aside>

      <div className="application-body">
        <header className="mobile-appbar">
          <a className="mobile-brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate('/') }}>
            <span className="brand-mark" aria-hidden="true">XL</span><span>XRPL Lending Monitor</span>
          </a>
          <button type="button" className="icon-button" onClick={onReload} aria-label="Refresh monitoring data">↻</button>
        </header>
        <ContextBar status={status} />
        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
        <footer className="site-footer">
          <p>XRPL Lending Devnet data. No wallet, signing, lending, repayment, or investment advice.</p>
          <div><a href="/api/status">Status JSON</a><a href="https://github.com/badjoke-lab/xrpl-lending-monitor">Source</a></div>
        </footer>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <a className={currentPath === '/' ? 'is-active' : ''} href="/" aria-current={currentPath === '/' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onNavigate('/') }}>Overview</a>
        <span aria-disabled="true">Loans</span>
        <span aria-disabled="true">Activity</span>
        <span aria-disabled="true">Search</span>
        <details>
          <summary>More</summary>
          <div className="mobile-more-panel"><Navigation currentPath={currentPath} onNavigate={onNavigate} /></div>
        </details>
      </nav>
    </div>
  )
}
