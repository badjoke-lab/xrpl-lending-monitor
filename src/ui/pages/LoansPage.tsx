import { useMemo, useState } from 'react'

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
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type {
  LoanCollectionResponse,
  LoanOnLedgerStatus,
  LoanScheduleStatus,
} from '../types/api'

interface LoansPageProps {
  onNavigate: (path: string) => void
}

interface LoanFilters {
  query: string
  sort: 'id_asc' | 'id_desc'
  onLedgerStatus: '' | LoanOnLedgerStatus
  scheduleStatus: '' | LoanScheduleStatus
}

function amount(value: string, assetKey: string): string {
  return `${value} ${assetKey}`
}

export function LoansPage({ onNavigate }: LoansPageProps) {
  const [draft, setDraft] = useState<LoanFilters>({
    query: '',
    sort: 'id_asc',
    onLedgerStatus: '',
    scheduleStatus: '',
  })
  const [filters, setFilters] = useState<LoanFilters>(draft)
  const [cursor, setCursor] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<string | null>>([])

  const url = useMemo(() => {
    const params = new URLSearchParams({ limit: '25', sort: filters.sort })
    if (filters.query) params.set('q', filters.query)
    if (filters.onLedgerStatus) params.set('on_ledger_status', filters.onLedgerStatus)
    if (filters.scheduleStatus) params.set('schedule_status', filters.scheduleStatus)
    if (cursor) params.set('cursor', cursor)
    return `/api/loans?${params.toString()}`
  }, [cursor, filters])

  const { resource, reload } = useApiResource<LoanCollectionResponse>(url)
  const response = resource.state === 'ready' ? resource.data : null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Monitor</p>
          <h1>Loans</h1>
          <p className="page-summary">
            Current Loan balances, payment schedule, and direct protocol state with verified Broker and Vault relationships.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={url}>Loan JSON</a>
        </div>
      </header>

      <Panel title="Find Loans" description="Filter direct ledger state separately from the derived payment schedule">
        <form
          className="loan-filter-form"
          onSubmit={(event) => {
            event.preventDefault()
            setFilters({ ...draft, query: draft.query.trim() })
            setCursor(null)
            setHistory([])
          }}
        >
          <label>
            <span>Search</span>
            <input
              value={draft.query}
              onChange={(event) => setDraft((value) => ({ ...value, query: event.target.value }))}
              placeholder="Loan ID, Broker ID, Borrower"
              maxLength={128}
            />
          </label>
          <label>
            <span>On-ledger</span>
            <select
              value={draft.onLedgerStatus}
              onChange={(event) => setDraft((value) => ({
                ...value,
                onLedgerStatus: event.target.value as LoanFilters['onLedgerStatus'],
              }))}
            >
              <option value="">All ledger states</option>
              <option value="active">Active</option>
              <option value="impaired">Impaired</option>
              <option value="defaulted">Defaulted</option>
            </select>
          </label>
          <label>
            <span>Schedule</span>
            <select
              value={draft.scheduleStatus}
              onChange={(event) => setDraft((value) => ({
                ...value,
                scheduleStatus: event.target.value as LoanFilters['scheduleStatus'],
              }))}
            >
              <option value="">All schedule states</option>
              <option value="current">Current</option>
              <option value="payment_due">Payment due</option>
              <option value="default_eligible">Default eligible</option>
              <option value="complete">Complete</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select
              value={draft.sort}
              onChange={(event) => setDraft((value) => ({
                ...value,
                sort: event.target.value as LoanFilters['sort'],
              }))}
            >
              <option value="id_asc">Loan ID ascending</option>
              <option value="id_desc">Loan ID descending</option>
            </select>
          </label>
          <button className="primary-button" type="submit">Apply</button>
        </form>
      </Panel>

      <div className="loan-state-note" role="note">
        <strong>Two independent states</strong>
        <span>On-ledger status comes from the Loan object. Schedule status is derived from due time, grace period, and the recorded evaluation time.</span>
      </div>

      {resource.state === 'loading' ? <LoadingBlock label="Loading current Loans" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}
      {response?.availability.state === 'unavailable' ? (
        <UnavailableBlock
          title="Loan collection unavailable"
          reason={response.availability.reason ?? 'Current Loan data is unavailable.'}
        />
      ) : null}

      {response?.availability.state === 'available' ? (
        <Panel
          title="Current Loans"
          description={`Snapshot ${response.snapshot?.id ?? 'Unavailable'} · ledger ${formatInteger(response.snapshot?.ledger_index)}`}
          action={<ProvenanceBadge value={response.provenance.collection} />}
        >
          {response.data.length === 0 ? (
            <EmptyBlock message={response.page.next_cursor ? 'No Loans matched in this bounded shard window. Continue to the next window.' : 'No Loans matched the current filters.'} />
          ) : (
            <div className="table-scroll" tabIndex={0} aria-label="Current Loans table">
              <table className="data-table loan-table">
                <thead>
                  <tr>
                    <th scope="col">Loan</th>
                    <th scope="col">Asset</th>
                    <th scope="col">On-ledger</th>
                    <th scope="col">Schedule</th>
                    <th scope="col">Principal</th>
                    <th scope="col">Outstanding</th>
                    <th scope="col">Periodic payment</th>
                    <th scope="col">Remaining</th>
                    <th scope="col">Next due</th>
                    <th scope="col">Broker</th>
                    <th scope="col">Vault</th>
                  </tr>
                </thead>
                <tbody>
                  {response.data.map((loan) => (
                    <tr key={loan.id}>
                      <td>
                        <a
                          className="identifier-link mono"
                          href={`/loans/${loan.id}`}
                          title={loan.id}
                          onClick={(event) => {
                            event.preventDefault()
                            onNavigate(`/loans/${loan.id}`)
                          }}
                        >{truncateMiddle(loan.id)}</a>
                        <small className="table-secondary mono">{truncateMiddle(loan.borrower, 6)}</small>
                      </td>
                      <td><span className="asset-chip">{loan.asset.key}</span></td>
                      <td><StatusBadge value={loan.on_ledger_status} /></td>
                      <td><StatusBadge value={loan.schedule_status} /></td>
                      <td className="mono">{amount(loan.principal_outstanding, loan.asset.key)}</td>
                      <td className="mono">{amount(loan.total_value_outstanding, loan.asset.key)}</td>
                      <td className="mono">{amount(loan.periodic_payment, loan.asset.key)}</td>
                      <td>{formatInteger(loan.payment_remaining)}</td>
                      <td>{formatUtc(loan.next_payment_due)}</td>
                      <td>
                        <a
                          className="identifier-link mono"
                          href={`/loan-brokers/${loan.related_loan_broker.id}`}
                          title={loan.related_loan_broker.id}
                          onClick={(event) => {
                            event.preventDefault()
                            onNavigate(`/loan-brokers/${loan.related_loan_broker.id}`)
                          }}
                        >{truncateMiddle(loan.related_loan_broker.id)}</a>
                      </td>
                      <td>
                        <a
                          className="identifier-link mono"
                          href={`/vaults/${loan.related_vault.id}`}
                          title={loan.related_vault.id}
                          onClick={(event) => {
                            event.preventDefault()
                            onNavigate(`/vaults/${loan.related_vault.id}`)
                          }}
                        >{truncateMiddle(loan.related_vault.id)}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination-bar">
            <span>
              Read {formatInteger(response.page.loan_shards_read)} Loan shard(s) + {formatInteger(response.page.relation_shards_read)} relationship shard(s) · examined {formatInteger(response.page.objects_examined)} Loan object(s)
            </span>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={history.length === 0}
                onClick={() => {
                  const previous = history.at(-1) ?? null
                  setHistory((items) => items.slice(0, -1))
                  setCursor(previous)
                }}
              >Previous</button>
              <button
                className="secondary-button"
                type="button"
                disabled={!response.page.next_cursor}
                onClick={() => {
                  setHistory((items) => [...items, cursor])
                  setCursor(response.page.next_cursor)
                }}
              >Next</button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
