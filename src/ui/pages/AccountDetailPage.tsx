import { useMemo } from 'react'

import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Panel,
  ProvenanceBadge,
  StatusBadge,
  UnavailableBlock,
} from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, truncateMiddle } from '../lib/formatting'
import type {
  LoanBrokerCollectionResponse,
  LoanCollectionResponse,
  VaultCollectionResponse,
} from '../types/api'
import type { SearchResponse, SearchResultRecord } from '../types/search'

interface AccountDetailPageProps {
  account: string
  onNavigate: (path: string) => void
}

const ACCOUNT_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

function RelatedLink({ path, label, identifier, onNavigate }: {
  path: string
  label: string
  identifier: string
  onNavigate: (path: string) => void
}) {
  return (
    <article className="account-relation-card">
      <div><StatusBadge value={label} /><ProvenanceBadge value="direct" /></div>
      <a
        className="identifier-link mono"
        href={path}
        title={identifier}
        onClick={(event) => { event.preventDefault(); onNavigate(path) }}
      >{truncateMiddle(identifier, 16)}</a>
    </article>
  )
}

function IndexedRelationship({ result, onNavigate }: {
  result: SearchResultRecord
  onNavigate: (path: string) => void
}) {
  const objectId = result.object_id ?? result.loan_id
  const normalizedType = (result.object_type ?? '').replaceAll('_', '').toLowerCase()
  const objectPath = objectId
    ? normalizedType === 'vault'
      ? `/vaults/${objectId}`
      : normalizedType === 'loanbroker'
        ? `/loan-brokers/${objectId}`
        : normalizedType === 'loan'
          ? `/loans/${objectId}`
          : null
    : null
  const path = objectPath ?? (result.transaction_hash ? `/transactions/${result.transaction_hash}` : null)
  const identifier = objectId ?? result.transaction_hash ?? 'Unavailable'

  return (
    <article className="account-indexed-card">
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
          title={identifier}
          onClick={(event) => { event.preventDefault(); onNavigate(path) }}
        >{truncateMiddle(identifier, 16)}</a>
      ) : <span className="mono">{truncateMiddle(identifier, 16)}</span>}
      <dl className="search-result-facts">
        <div><dt>Object type</dt><dd>{result.object_type ?? 'Unavailable'}</dd></div>
        <div><dt>Epoch</dt><dd className="mono">{result.epoch_id}</dd></div>
        <div><dt>Ledger</dt><dd>{formatInteger(result.ledger_index)}</dd></div>
        <div><dt>Transaction</dt><dd className="mono">{result.transaction_hash ? truncateMiddle(result.transaction_hash, 10) : 'Unavailable'}</dd></div>
      </dl>
    </article>
  )
}

export function AccountDetailPage({ account, onNavigate }: AccountDetailPageProps) {
  const valid = ACCOUNT_PATTERN.test(account)
  const encoded = encodeURIComponent(account)
  const vaults = useApiResource<VaultCollectionResponse>(valid ? `/api/vaults?limit=100&q=${encoded}` : null)
  const brokers = useApiResource<LoanBrokerCollectionResponse>(valid ? `/api/loan-brokers?limit=100&q=${encoded}` : null)
  const loans = useApiResource<LoanCollectionResponse>(valid ? `/api/loans?limit=100&q=${encoded}` : null)
  const history = useApiResource<SearchResponse>(valid ? `/api/search?q=${encoded}&limit=100` : null)

  const currentVaults = vaults.resource.state === 'ready'
    ? vaults.resource.data.data.filter((value) => value.owner === account || value.account === account)
    : []
  const currentBrokers = brokers.resource.state === 'ready'
    ? brokers.resource.data.data.filter((value) => value.owner === account || value.account === account)
    : []
  const borrowerLoans = loans.resource.state === 'ready'
    ? loans.resource.data.data.filter((value) => value.borrower === account)
    : []
  const indexed = history.resource.state === 'ready' ? history.resource.data.data : []

  const uniqueIndexed = useMemo(() => {
    const seen = new Set<string>()
    return indexed.filter((result) => {
      const key = [result.kind, result.epoch_id, result.transaction_hash, result.object_type, result.object_id, result.loan_id].join(':')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [indexed])

  const transactionHashes = useMemo(
    () => Array.from(new Set(uniqueIndexed.map((result) => result.transaction_hash).filter((value): value is string => Boolean(value)))),
    [uniqueIndexed],
  )

  if (!valid) {
    return (
      <div className="page-stack">
        <header className="page-header">
          <div>
            <p className="page-kicker">Monitor · Account</p>
            <h1>Invalid XRPL account</h1>
            <p className="page-summary mono">{account}</p>
          </div>
        </header>
        <div className="state-block state-error" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <div>
            <strong>Malformed account identifier</strong>
            <p>Account routes require a classic XRPL address beginning with r. No API request was made.</p>
            <button className="secondary-button" type="button" onClick={() => onNavigate('/search')}>Return to Search</button>
          </div>
        </div>
      </div>
    )
  }

  const currentLoading = vaults.resource.state === 'loading' || brokers.resource.state === 'loading' || loans.resource.state === 'loading'
  const currentErrors = [vaults.resource, brokers.resource, loans.resource].filter((resource) => resource.state === 'error')
  const currentUnavailable = [
    vaults.resource.state === 'ready' ? vaults.resource.data.availability : null,
    brokers.resource.state === 'ready' ? brokers.resource.data.availability : null,
    loans.resource.state === 'ready' ? loans.resource.data.availability : null,
  ].find((availability) => availability?.state === 'unavailable')

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Monitor · Account</p>
          <h1>Protocol Account Relationships</h1>
          <p className="page-summary">
            Ledger-recorded relationships involving this XRPL account. This page makes no off-chain identity, ownership, affiliation, or credit claim.
          </p>
          <p className="account-identifier mono">{account}</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => onNavigate(`/search?q=${encodeURIComponent(account)}`)}>Search this account</button>
          <a className="secondary-button" href={`/api/search?q=${encoded}&limit=100`}>Indexed JSON</a>
        </div>
      </header>

      <div className="account-scope-note" role="note">
        <strong>Relationship scope</strong>
        <span>Current objects are direct active-snapshot records. Historical and archived relationships are separately labeled Indexed and do not imply current existence.</span>
      </div>

      <Panel title="Current protocol relationships" description="Exact matches from the active verified current-state snapshot">
        {currentLoading ? <LoadingBlock label="Loading current account relationships" /> : null}
        {currentErrors.map((resource, index) => resource.state === 'error'
          ? <ErrorBlock key={index} message={resource.error} />
          : null)}
        {currentUnavailable ? (
          <UnavailableBlock
            title="Current relationships unavailable"
            reason={currentUnavailable.reason ?? 'The verified active current-state snapshot is not available.'}
          />
        ) : null}
        {!currentLoading && currentErrors.length === 0 && !currentUnavailable ? (
          <div className="account-current-groups">
            <section aria-labelledby="account-vaults">
              <h3 id="account-vaults">Owned or controlled Vault records</h3>
              <p>{formatInteger(currentVaults.length)} exact current match(es)</p>
              {currentVaults.length ? <div className="account-relation-list">{currentVaults.map((vault) => (
                <RelatedLink key={vault.id} path={`/vaults/${vault.id}`} label="Vault" identifier={vault.id} onNavigate={onNavigate} />
              ))}</div> : <EmptyBlock message="No current Vault record matched this account as owner or Vault pseudo-account." />}
            </section>
            <section aria-labelledby="account-brokers">
              <h3 id="account-brokers">Managed Loan Broker records</h3>
              <p>{formatInteger(currentBrokers.length)} exact current match(es)</p>
              {currentBrokers.length ? <div className="account-relation-list">{currentBrokers.map((broker) => (
                <RelatedLink key={broker.id} path={`/loan-brokers/${broker.id}`} label="Loan Broker" identifier={broker.id} onNavigate={onNavigate} />
              ))}</div> : <EmptyBlock message="No current Loan Broker record matched this account as owner or Broker pseudo-account." />}
            </section>
            <section aria-labelledby="account-loans">
              <h3 id="account-loans">Borrower Loan records</h3>
              <p>{formatInteger(borrowerLoans.length)} exact current match(es)</p>
              {borrowerLoans.length ? <div className="account-relation-list">{borrowerLoans.map((loan) => (
                <RelatedLink key={loan.id} path={`/loans/${loan.id}`} label="Loan" identifier={loan.id} onNavigate={onNavigate} />
              ))}</div> : <EmptyBlock message="No current Loan record matched this account as Borrower." />}
            </section>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Indexed and archived relationships"
        description="Exact account matches preserved by history and archive indexing"
        action={<ProvenanceBadge value="indexed" />}
      >
        {history.resource.state === 'loading' ? <LoadingBlock label="Loading indexed account relationships" /> : null}
        {history.resource.state === 'error' ? <ErrorBlock message={history.resource.error} onRetry={history.reload} /> : null}
        {history.resource.state === 'ready' && uniqueIndexed.length === 0 ? (
          <EmptyBlock message="The history index is available, but contains no exact relationship for this account." />
        ) : null}
        {uniqueIndexed.length ? <div className="account-indexed-list">{uniqueIndexed.map((result, index) => (
          <IndexedRelationship key={`${result.kind}:${result.transaction_hash ?? index}:${result.object_id ?? result.loan_id ?? ''}`} result={result} onNavigate={onNavigate} />
        ))}</div> : null}
      </Panel>

      <Panel title="Protocol transactions" description={`${formatInteger(transactionHashes.length)} unique indexed transaction(s) related to this account`}>
        {history.resource.state === 'ready' && transactionHashes.length === 0 ? (
          <EmptyBlock message="No indexed protocol transaction hash is currently associated with this account." />
        ) : (
          <div className="account-transaction-list">
            {transactionHashes.map((hash) => (
              <a
                key={hash}
                className="identifier-link mono"
                href={`/transactions/${hash}`}
                title={hash}
                onClick={(event) => { event.preventDefault(); onNavigate(`/transactions/${hash}`) }}
              >{truncateMiddle(hash, 18)}</a>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
