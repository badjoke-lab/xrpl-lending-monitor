const SITE_NAME = 'XRPL Lending Monitor'
const DEFAULT_DESCRIPTION =
  'Read-only monitoring, history, and audit tooling for the XRPL Lending Protocol on Devnet.'

export type RobotsDirective = 'index,follow' | 'noindex,follow' | 'noindex,nofollow'

export interface PageSeoMetadata {
  title: string
  description: string
  robots: RobotsDirective
  canonicalPath: string | null
}

const STATIC_PAGE_METADATA: Record<string, Omit<PageSeoMetadata, 'canonicalPath'>> = {
  '/': {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    robots: 'index,follow',
  },
  '/vaults': {
    title: `Vaults | ${SITE_NAME}`,
    description: 'Explore verified XRPL Lending Vault state, balances, availability, loss, utilization, and provenance on Devnet.',
    robots: 'index,follow',
  },
  '/loan-brokers': {
    title: `Loan Brokers | ${SITE_NAME}`,
    description: 'Inspect XRPL Lending Loan Broker debt, cover, limits, relationships, and provenance on Devnet.',
    robots: 'index,follow',
  },
  '/loans': {
    title: `Loans | ${SITE_NAME}`,
    description: 'Browse XRPL Lending Loan state, balances, payment schedules, Broker and Vault relationships, and provenance on Devnet.',
    robots: 'index,follow',
  },
  '/activity': {
    title: `Protocol Activity | ${SITE_NAME}`,
    description: 'Review indexed XRPL Lending and Single Asset Vault protocol activity with ledger, transaction, result, and provenance context.',
    robots: 'index,follow',
  },
  '/audit/lifecycle': {
    title: `Loan Lifecycle Audit | ${SITE_NAME}`,
    description: 'Explore indexed XRPL Lending Loan lifecycle events, payments, state transitions, source transactions, and provenance.',
    robots: 'index,follow',
  },
  '/audit/archived': {
    title: `Archived Objects | ${SITE_NAME}`,
    description: 'Search deleted XRPL Lending Vault, Loan Broker, and Loan objects retained for historical audit within the collected evidence boundary.',
    robots: 'index,follow',
  },
  '/audit/cover-loss': {
    title: `Cover & Loss Audit | ${SITE_NAME}`,
    description: 'Inspect asset-separated XRPL Lending debt, first-loss cover, required cover, surplus or shortfall, and unrealized loss history.',
    robots: 'index,follow',
  },
  '/epochs': {
    title: `Devnet Epochs | ${SITE_NAME}`,
    description: 'Browse preserved XRPL Lending Devnet epochs and reset boundaries without mixing current and historical eras.',
    robots: 'index,follow',
  },
  '/search': {
    title: `Search | ${SITE_NAME}`,
    description: 'Search XRPL Lending monitor data by object ID, transaction hash, account, relationship, and supported asset identifiers.',
    robots: 'index,follow',
  },
  '/network-status': {
    title: `Network Status | ${SITE_NAME}`,
    description: 'Check XRPL Lending Devnet amendment state, validated ledger context, collector freshness, lag, and public-safe runtime status.',
    robots: 'index,follow',
  },
  '/api': {
    title: `Read-only API | ${SITE_NAME}`,
    description: 'Read the XRPL Lending Monitor API documentation, bounded pagination rules, provenance, availability states, exports, and feeds.',
    robots: 'index,follow',
  },
  '/methodology': {
    title: `Methodology | ${SITE_NAME}`,
    description: 'Read how XRPL Lending Monitor collects validated ledger data, reconstructs history, handles epochs, provenance, and evidence boundaries.',
    robots: 'index,follow',
  },
  '/about': {
    title: `About | ${SITE_NAME}`,
    description: 'Learn why XRPL Lending Monitor exists, what it observes, its read-only Devnet scope, and how its historical audit layer differs.',
    robots: 'index,follow',
  },
  '/contact': {
    title: `Contact | ${SITE_NAME}`,
    description: 'Contact the XRPL Lending Monitor project about bugs, data corrections, API issues, documentation, or other inquiries.',
    robots: 'index,follow',
  },
}

function dynamicMetadata(pathname: string): PageSeoMetadata | null {
  if (/^\/vaults\/[A-Fa-f0-9]{64}$/.test(pathname)) {
    return {
      title: `Vault Detail | ${SITE_NAME}`,
      description: 'Inspect one verified XRPL Lending Vault with current fields, relationships, activity, historical changes, and provenance.',
      robots: 'noindex,follow',
      canonicalPath: pathname,
    }
  }
  if (/^\/loan-brokers\/[A-Fa-f0-9]{64}$/.test(pathname)) {
    return {
      title: `Loan Broker Detail | ${SITE_NAME}`,
      description: 'Inspect one XRPL Lending Loan Broker with debt, cover, related Vault and Loans, historical changes, and provenance.',
      robots: 'noindex,follow',
      canonicalPath: pathname,
    }
  }
  if (/^\/loans\/[A-Fa-f0-9]{64}$/.test(pathname)) {
    return {
      title: `Loan Detail | ${SITE_NAME}`,
      description: 'Inspect one XRPL Lending Loan with balances, payment schedule, lifecycle, state changes, relationships, and provenance.',
      robots: 'noindex,follow',
      canonicalPath: pathname,
    }
  }
  if (/^\/transactions\/[^/]+$/.test(pathname)) {
    return {
      title: `Transaction Detail | ${SITE_NAME}`,
      description: 'Inspect one indexed XRPL Lending transaction with metadata, affected objects, normalized changes, and provenance.',
      robots: 'noindex,follow',
      canonicalPath: pathname,
    }
  }
  if (/^\/accounts\/[^/]+$/.test(pathname)) {
    return {
      title: `Account Relationships | ${SITE_NAME}`,
      description: 'Inspect on-ledger XRPL Lending relationships and indexed protocol activity for one account within the evidence boundary.',
      robots: 'noindex,follow',
      canonicalPath: pathname,
    }
  }
  if (/^\/audit\/archived\/(Vault|LoanBroker|Loan)\/[^/]+$/.test(pathname)) {
    return {
      title: `Archived Object Detail | ${SITE_NAME}`,
      description: 'Inspect retained final state, deletion evidence, relationships, raw archive context, and provenance for one archived protocol object.',
      robots: 'noindex,follow',
      canonicalPath: pathname,
    }
  }
  if (/^\/epochs\/[^/]+$/.test(pathname)) {
    return {
      title: `Devnet Epoch Detail | ${SITE_NAME}`,
      description: 'Inspect one preserved XRPL Lending Devnet epoch with ledger boundaries, reset context, indexed counts, and provenance.',
      robots: 'noindex,follow',
      canonicalPath: pathname,
    }
  }
  return null
}

export function normalizePublicSiteOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.origin
  } catch {
    return null
  }
}

export function resolvePageSeoMetadata(pathname: string): PageSeoMetadata {
  const staticMetadata = STATIC_PAGE_METADATA[pathname]
  if (staticMetadata) {
    return { ...staticMetadata, canonicalPath: pathname }
  }

  return (
    dynamicMetadata(pathname) ?? {
      title: `Page Not Found | ${SITE_NAME}`,
      description: DEFAULT_DESCRIPTION,
      robots: 'noindex,nofollow',
      canonicalPath: null,
    }
  )
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.content = content
}

function setCanonical(canonicalUrl: string | null) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonicalUrl) {
    link?.remove()
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = canonicalUrl
}

function setStructuredData(metadata: PageSeoMetadata, canonicalUrl: string | null) {
  const scriptId = 'xrpl-lending-monitor-structured-data'
  let script = document.getElementById(scriptId) as HTMLScriptElement | null

  if (!canonicalUrl || metadata.robots !== 'index,follow') {
    script?.remove()
    return
  }

  if (!script) {
    script = document.createElement('script')
    script.id = scriptId
    script.type = 'application/ld+json'
    document.head.appendChild(script)
  }

  const isHome = metadata.canonicalPath === '/'
  const payload = isHome
    ? {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: canonicalUrl,
        description: metadata.description,
        inLanguage: 'en',
        isAccessibleForFree: true,
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: metadata.title,
        url: canonicalUrl,
        description: metadata.description,
        inLanguage: 'en',
        isPartOf: {
          '@type': 'WebSite',
          name: SITE_NAME,
          url: new URL('/', canonicalUrl).toString(),
        },
      }

  script.textContent = JSON.stringify(payload)
}

export function applyPageSeoMetadata(pathname: string) {
  const metadata = resolvePageSeoMetadata(pathname)
  const publicSiteOrigin = normalizePublicSiteOrigin(import.meta.env.VITE_PUBLIC_SITE_ORIGIN)
  const canonicalUrl =
    publicSiteOrigin && metadata.canonicalPath
      ? new URL(metadata.canonicalPath, `${publicSiteOrigin}/`).toString()
      : null

  document.title = metadata.title
  setMeta('meta[name="description"]', 'name', 'description', metadata.description)
  setMeta('meta[name="robots"]', 'name', 'robots', metadata.robots)
  setMeta('meta[property="og:type"]', 'property', 'og:type', 'website')
  setMeta('meta[property="og:site_name"]', 'property', 'og:site_name', SITE_NAME)
  setMeta('meta[property="og:title"]', 'property', 'og:title', metadata.title)
  setMeta('meta[property="og:description"]', 'property', 'og:description', metadata.description)
  setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary')
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', metadata.title)
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', metadata.description)

  if (canonicalUrl) {
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonicalUrl)
  } else {
    document.head.querySelector('meta[property="og:url"]')?.remove()
  }

  setCanonical(canonicalUrl)
  setStructuredData(metadata, canonicalUrl)
}
