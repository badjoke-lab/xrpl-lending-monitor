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
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { LifecycleExplorerResponse, LoanLifecycleEvent } from '../types/api'

interface LifecycleAuditPageProps {
  onNavigate: (path: string) => void
}

interface Filters {
  eventType: string
  loanId: string
}

const EVENT_TYPES = ['', 'created', 'payment', 'paid', 'impaired', 'unimpaired', 'defaulted', 'deleted', 'updated']
const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search)
  return {
    eventType: params.get('event_type') ?? '',
    loanId: params.get('loan_id') ?? '',
  }
}

function rippleTimeToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null
  return new Date((value + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function lifecycleUrl(filters: Filters): string {
  const params = new URLSearchParams({ limit: '100' })
  if (filters.eventType) params.set('event_type', filters.eventType)
  if (filters.loanId) params.set('loan_id', filters.loanId)
  return `/api/audit/lifecycle?${params.toString()}`
}

function saveFilters(filters: Filters): void {
  const params = new URLSearchParams()
  if (filters.eventType) params.set('event_type', filters.eventType)
  if (filters.loanId) params.set('loan_id', filters.loanId)
  const suffix = params.toString()
  window.history.replaceState({}, '', suffix ? `/audit/lifecycle?${suffix}` : '/audit/lifecycle')
}

function changeSummary(event: LoanLifecycleEvent): string {
  const principal = event.principal_before !== event.principal_after
    ? `Principal ${event.principal_before ?? 'Unavailable'} -> ${event.principal_after ?? 'Unavailable'}`
    : null
  const total = event.total_value_before !== event.total_value_after
    ? `Total ${event.total_value_before ?? 'Unavailable'} -> ${event.total_value_after ?? 'Unavailable'}`
    : null
  const payments = event.payment_remaining_before !== event.payment_remaining_after
    ? `Payments ${formatInteger(event.payment_remaining_before)} -> ${formatInteger(event.payment_remaining_after)}`
    : null
  return [principal, total, payments].filter(Boolean).join('; ') || 'No balance or payment-count delta recorded'
}

export function LifecycleAuditPage({ onNavigate }: LifecycleAuditPageProps) {
  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [filters, setFilters] = useState<Filters>(draft)
  const { resource, reload } = useApiResource<LifecycleExplorerResponse>(lifecycleUrl(filters))
  const response = resource.state === 'ready' ? resource.data : null

  const events = useMemo(() => response?.data ?? [], [response])

  return (
    <div className="page-stack lifecycle-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Audit</p>
          <h1>Loan Lifecycle</h1>
          <p className="page-summary">
            Indexed Loan lifecycle events from collected validated Devnet history. Events are not inferred when source evidence is unavailable.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={lifecycleUrl(filters)}>Lifecycle JSON</a>
        </div>
      </header>

      <div className="activity-scope-note" role="note">
        <strong>Evidence boundary</strong>
        <span>Payment, impairment, default, repayment, and deletion records are indexed facts. Schedule-derived default eligibility is not shown as an on-ledger default.</span>
      </div>

      <Panel title="Filter lifecycle events" description="Filters apply to the latest bounded 100-event lifecycle API window">
        <form
          className="activity-filter-form"
          onSubmit={(event) => {
            event.preventDefault()
            const next = { eventType: draft.eventType, loanId: draft.loanId.trim().toUpperCase() }
            setFilters(next)
            saveFilters(next)
          }}
        >
          <label>
            <span>Event type</span>
            <select
              value={draft.eventType}
              onChange={(event) => setDraft((value) => ({ ...value, eventType: event.target.value }))}
            >
              {EVENT_TYPES.map((type) => (
                <option key={type || 'all'} value={type}>{type ? type : 'All lifecycle events'}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Loan ID</span>
            <input
              value={draft.loanId}
              onChange={(event) => setDraft((value) => ({ ...value, loanId: event.target.value }))}
              placeholder="Exact 64-character Loan ID"
              maxLength={128}
            />
          </label>
          <button className="primary-button" type="submit">Apply</button>
        </form>
      </Panel>

      {resource.state === 'loading' ? <LoadingBlock label="Loading Loan lifecycle events" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response ? (
        <Panel
          title="Indexed lifecycle timeline"
          description={`${formatInteger(events.length)} event(s) returned from the bounded lifecycle API`}
          action={<ProvenanceBadge value={response.provenance.collection} />}
        >
          {events.length === 0 ? (
            <EmptyBlock message="No indexed Loan lifecycle events matched the current filters." />
          ) : (
            <div className="lifecycle-timeline" aria-label="Loan lifecycle events">
              {events.map((event) => (
                <article className="lifecycle-event-card" key={`${event.loan_id}:${event.transaction_hash}:${event.event_type}`}>
                  <header>
                    <div>
                      <span className="node-index">Ledger {formatInteger(event.ledger_index)} · #{formatInteger(event.transaction_index)}</span>
                      <h2><StatusBadge value={event.event_type} /> <span>{event.transaction_type}</span></h2>
                      <p>{formatUtc(rippleTimeToIso(event.close_time))} UTC · {event.result_code}</p>
                    </div>
                    <ProvenanceBadge value={event.provenance} />
                  </header>
                  <dl className="lifecycle-state-grid">
                    <div><dt>Loan</dt><dd><a href={`/loans/${event.loan_id}`} onClick={(click) => { click.preventDefault(); onNavigate(`/loans/${event.loan_id}`) }}>{truncateMiddle(event.loan_id, 12)}</a></dd></div>
                    <div><dt>Transaction</dt><dd><a href={`/transactions/${event.transaction_hash}`} onClick={(click) => { click.preventDefault(); onNavigate(`/transactions/${event.transaction_hash}`) }}>{truncateMiddle(event.transaction_hash, 12)}</a></dd></div>
                    <div><dt>Before</dt><dd><StatusBadge value={event.status_before} /></dd></div>
                    <div><dt>After</dt><dd><StatusBadge value={event.status_after} /></dd></div>
                  </dl>
                  <p className="lifecycle-change-summary">{changeSummary(event)}</p>
                  <details>
                    <summary>Indexed details</summary>
                    <pre className="raw-data-panel"><code>{JSON.stringify(event.details_json, null, 2)}</code></pre>
                  </details>
                </article>
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  )
}
