import { useMemo, useState } from 'react'

import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Panel,
  ProvenanceBadge,
  StatusBadge,
} from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, truncateMiddle } from '../lib/formatting'
import type { SearchResponse, SearchResultKind, SearchResultRecord } from '../types/search'

interface SearchPageProps {
  onNavigate: (path: string) => void
}

const ACCOUNT_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const HEX_256_PATTERN = /^[A-Fa-f0-9]{64}$/

function initialQuery(): string {
  return new URLSearchParams(window.location.search).get('q')?.trim() ?? ''
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function validateQuery(query: string): string | null {
  if (!query) return 'Enter an exact indexed identifier, account, asset key, or transaction hash.'
  if (query.length > 128) return 'Search queries must be 128 characters or fewer.'
  if (containsControlCharacter(query)) return 'Search queries cannot contain control characters.'
  if (query.startsWith('r') && !ACCOUNT_PATTERN.test(query)) {
    return 'An XRPL account must be a valid classic-address shape beginning with r.'
  }
  if (query.length === 64 && !HEX_256_PATTERN.test(query)) {
    return 'A 64-character identifier must contain hexadecimal characters only.'
  }
  return null
}

function resultPath(result: SearchResultRecord): string | null {
  if (result.kind === 'transaction' && result.transaction_hash) {
    return `/transactions/${result.transaction_hash}`
  }
  const objectId = result.object_id ?? result.loan_id
  if (!objectId) return result.transaction_hash ? `/transactions/${result.transaction_hash}` : null
  switch ((result.object_type ?? '').replaceAll('_', '').toLowerCase()) {
    case 'vault':
      return `/vaults/${objectId}`
    case 'loanbroker':
      return `/loan-brokers/${objectId}`
    case 'loan':
      return `/loans/${objectId}`
    default:
      return result.transaction_hash ? `/transactions/${result.transaction_hash}` : null
  }
}

function resultTitle(result: SearchResultRecord): string {
  if (result.kind === 'transaction') return result.transaction_hash ?? 'Transaction'
  return result.object_id ?? result.loan_id ?? result.transaction_hash ?? 'Indexed record'
}

function groupLabel(kind: SearchResultKind): string {
  switch (kind) {
    case 'transaction': return 'Transactions'
    case 'object_change': return 'Current or historical object changes'
    case 'archived_object': return 'Archived objects'
    case 'loan_lifecycle': return 'Loan lifecycle records'
  }
}

export function SearchPage({ onNavigate }: SearchPageProps) {
  const startingQuery = initialQuery()
  const startingError = startingQuery ? validateQuery(startingQuery) : null
  const [draft, setDraft] = useState(startingQuery)
  const [submittedQuery, setSubmittedQuery] = useState(startingError ? '' : startingQuery)
  const [validationError, setValidationError] = useState<string | null>(startingError)
  const requestUrl = submittedQuery
    ? `/api/search?q=${encodeURIComponent(submittedQuery)}&limit=100`
    : null
  const { resource, reload } = useApiResource<SearchResponse>(requestUrl)
  const response = resource.state === 'ready' ? resource.data : null

  const grouped = useMemo(() => {
    const groups = new Map<SearchResultKind, SearchResultRecord[]>()
    const seen = new Set<string>()
    for (const result of response?.data ?? []) {
      const key = [result.kind, result.epoch_id, result.ledger_index, result.transaction_hash, result.object_type, result.object_id, result.loan_id].join(':')
      if (seen.has(key)) continue
      seen.add(key)
      const values = groups.get(result.kind) ?? []
      values.push(result)
      groups.set(result.kind, values)
    }
    return groups
  }, [response])

  const isAccount = ACCOUNT_PATTERN.test(submittedQuery)

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Monitor</p>
          <h1>Global Search</h1>
          <p className="page-summary">
            Exact-match search across indexed transactions, object changes, archived records, Loan lifecycle records, accounts, assets, and protocol identifiers.
          </p>
        </div>
        <div className="page-actions">
          {submittedQuery ? <button className="secondary-button" type="button" onClick={reload}>Refresh</button> : null}
          <a className="secondary-button" href={submittedQuery ? `/api/search?q=${encodeURIComponent(submittedQuery)}&limit=100` : '/api#search'}>Search API</a>
        </div>
      </header>

      <Panel title="Search the indexed record" description="The API performs exact matching; no fuzzy identity or off-chain attribution is added.">
        <form
          className="global-search-form"
          onSubmit={(event) => {
            event.preventDefault()
            const next = draft.trim()
            const error = validateQuery(next)
            setValidationError(error)
            if (error) {
              setSubmittedQuery('')
              return
            }
            setSubmittedQuery(next)
            window.history.replaceState({}, '', `/search?q=${encodeURIComponent(next)}`)
          }}
        >
          <label>
            <span>Exact identifier or relationship value</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Transaction hash, object ID, XRPL account, MPT issuance ID, or asset key"
              maxLength={128}
              aria-describedby={validationError ? 'search-help search-error' : 'search-help'}
            />
          </label>
          <button className="primary-button" type="submit">Search</button>
        </form>
        <p id="search-help" className="field-help">
          Supported indexed targets include Vault, Loan Broker, and Loan IDs; transaction hashes; XRPL accounts; MPT issuance IDs; and canonical asset keys.
        </p>
        {validationError ? <p id="search-error" className="field-error" role="alert">{validationError}</p> : null}
      </Panel>

      {!submittedQuery ? (
        <Panel title="Search behavior" description="Network and epoch boundaries are preserved in every result.">
          <div className="search-guidance-grid">
            <div><strong>Exact, bounded results</strong><p>Results come from the latest bounded read-only Search API response.</p></div>
            <div><strong>Current versus archived</strong><p>Archived records are labeled separately and are not presented as current objects.</p></div>
            <div><strong>No identity claims</strong><p>Account values are ledger relationships only; no person or organization is inferred.</p></div>
          </div>
        </Panel>
      ) : null}

      {submittedQuery && resource.state === 'loading' ? <LoadingBlock label="Searching indexed records" /> : null}
      {submittedQuery && resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response ? (
        <>
          <div className="search-result-summary" role="status">
            <div>
              <span>Exact query</span>
              <strong className="mono">{response.query}</strong>
            </div>
            <div>
              <span>Matches</span>
              <strong>{formatInteger(response.data.length)}</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>Devnet</strong>
            </div>
            {isAccount ? (
              <button className="secondary-button" type="button" onClick={() => onNavigate(`/accounts/${submittedQuery}`)}>
                Open account relationships
              </button>
            ) : null}
          </div>

          {response.data.length === 0 ? (
            <EmptyBlock message="The indexed search completed successfully, but no exact record matched this value." />
          ) : (
            Array.from(grouped.entries()).map(([kind, results]) => (
              <Panel
                key={kind}
                title={groupLabel(kind)}
                description={`${formatInteger(results.length)} unique indexed result(s)`}
                action={<ProvenanceBadge value="indexed" />}
              >
                <div className="search-result-list">
                  {results.map((result, index) => {
                    const path = resultPath(result)
                    const title = resultTitle(result)
                    return (
                      <article className="search-result-card" key={`${kind}:${title}:${result.transaction_hash ?? index}`}>
                        <div className="search-result-heading">
                          <div>
                            <StatusBadge value={result.kind} />
                            {result.kind === 'archived_object' ? <StatusBadge value="archived" /> : null}
                          </div>
                          <ProvenanceBadge value={result.provenance} />
                        </div>
                        {path ? (
                          <a
                            className="identifier-link mono"
                            href={path}
                            title={title}
                            onClick={(event) => { event.preventDefault(); onNavigate(path) }}
                          >{truncateMiddle(title, 16)}</a>
                        ) : <span className="mono">{truncateMiddle(title, 16)}</span>}
                        <dl className="search-result-facts">
                          <div><dt>Epoch</dt><dd className="mono">{result.epoch_id}</dd></div>
                          <div><dt>Ledger</dt><dd>{formatInteger(result.ledger_index)}</dd></div>
                          <div><dt>Object type</dt><dd>{result.object_type ?? 'Unavailable'}</dd></div>
                          <div><dt>Transaction</dt><dd className="mono">{result.transaction_hash ? truncateMiddle(result.transaction_hash, 10) : 'Unavailable'}</dd></div>
                        </dl>
                        {result.kind === 'archived_object' ? (
                          <p className="result-context-note">Archived context only. Current-state existence is not implied.</p>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </Panel>
            ))
          )}
        </>
      ) : null}
    </div>
  )
}
