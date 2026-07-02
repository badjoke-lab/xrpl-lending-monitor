import type { MouseEvent } from 'react'

interface BreadcrumbsProps {
  currentPath: string
  onNavigate: (path: string) => void
}

interface BreadcrumbItem {
  label: string
  path?: string
  title?: string
}

function shortenIdentifier(value: string): string {
  if (value.length <= 20) return value
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function decodeIdentifier(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function resolveBreadcrumbs(currentPath: string): BreadcrumbItem[] {
  const overview: BreadcrumbItem = { label: 'Overview', path: '/' }
  if (currentPath === '/') return [{ label: 'Overview' }]

  const detailRoutes: Array<{
    pattern: RegExp
    collection: BreadcrumbItem
    detailLabel?: string
  }> = [
    { pattern: /^\/vaults\/([^/]+)$/, collection: { label: 'Vaults', path: '/vaults' } },
    { pattern: /^\/loan-brokers\/([^/]+)$/, collection: { label: 'Loan Brokers', path: '/loan-brokers' } },
    { pattern: /^\/loans\/([^/]+)$/, collection: { label: 'Loans', path: '/loans' } },
    { pattern: /^\/transactions\/([^/]+)$/, collection: { label: 'Activity', path: '/activity' }, detailLabel: 'Transaction' },
    { pattern: /^\/accounts\/([^/]+)$/, collection: { label: 'Search', path: '/search' }, detailLabel: 'Account' },
  ]

  for (const route of detailRoutes) {
    const match = route.pattern.exec(currentPath)
    if (match?.[1]) {
      const identifier = decodeIdentifier(match[1])
      const label = route.detailLabel
        ? `${route.detailLabel} ${shortenIdentifier(identifier)}`
        : shortenIdentifier(identifier)
      return [overview, route.collection, { label, title: identifier }]
    }
  }

  const labels: Record<string, string> = {
    '/network-status': 'Network Status',
    '/vaults': 'Vaults',
    '/loan-brokers': 'Loan Brokers',
    '/loans': 'Loans',
    '/activity': 'Activity',
    '/search': 'Search',
    '/audit/lifecycle': 'Lifecycle',
    '/api': 'API',
    '/methodology': 'Methodology',
    '/about': 'About',
    '/contact': 'Contact',
  }

  return [overview, { label: labels[currentPath] ?? 'Page not found' }]
}

export function Breadcrumbs({ currentPath, onNavigate }: BreadcrumbsProps) {
  const items = resolveBreadcrumbs(currentPath)
  const navigate = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault()
    onNavigate(path)
  }

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li key={`${item.path ?? 'current'}-${item.label}`}>
              {item.path && !current ? (
                <a href={item.path} onClick={(event) => navigate(event, item.path ?? '/')}>{item.label}</a>
              ) : (
                <span aria-current={current ? 'page' : undefined} title={item.title}>{item.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
