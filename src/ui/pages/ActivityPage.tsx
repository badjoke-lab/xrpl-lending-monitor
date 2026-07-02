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
import type { ActivityCollectionResponse } from '../types/activity'

interface ActivityPageProps {
  onNavigate: (path: string) => void
}

interface ActivityFilters {
  query: string
  transactionType: string
  resultCode: string
  epochId: string
  fromUtc: string
  toUtc: string
}

const PAGE_SIZE = 25
const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function initialFilters(): ActivityFilters {
  const params = new URLSearchParams(window.location.search)
  return {
    query: params.get('q') ?? '',
    transactionType: params.get('type') ?? '',
    resultCode: params.get('result') ?? '',
    epochId: params.get('epoch') ?? '',
    fromUtc: params.get('from') ?? '',
    toUtc: params.get('to') ?? '',
  }
}

function rippleTimeToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null
  return new Date((value + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function inputToRippleTime(value: string): number | null {
  if (!value) return null
  const milliseconds = new Date(value).getTime()
  if (!Number.isFinite(milliseconds)) return null
  return Math.floor(milliseconds / 1000) - RIPPLE_EPOCH_UNIX_SECONDS
}

function saveFilters(filters: ActivityFilters): void {
  const params = new URLSearchParams()
  if (filters.query) params.set('q', filters.query)
  if (filters.transactionType) params.set('type', filters.transactionType)
  if (filters.resultCode) params.set('result', filters.resultCode)
  if (filters.epochId) params.set('epoch', filters.epochId)
  if (filters.fromUtc) params.set('from', filters.fromUtc)
  if (filters.toUtc) params.set('to', filters.toUtc)
  const suffix = params.toString()
  window.history.replaceState({}, '', suffix ? `/activity?${suffix}` : '/activity')
}

export function ActivityPage({ onNavigate }: ActivityPageProps) {
  const [draft, setDraft] = useState<ActivityFilters>(initialFilters)
  const [filters, setFilters] = useState<ActivityFilters>(draft)
  const [page, setPage] = useState(0)
  const { resource, reload } = useApiResource<ActivityCollectionResponse>('/api/activity?limit=100')
  const response = resource.state === 'ready' ? resource.data : null

  const filtered = useMemo(() => {
    const query = filters.query.trim().toUpperCase()
    const transactionType = filters.transactionType.trim().toUpperCase()
    const resultCode = filters.resultCode.trim().toUpperCase()
    const epochId = filters.epochId.trim().toUpperCase()
    const from = inputToRippleTime(filters.fromUtc)
    const to = inputToRippleTime(filters.toUtc)

    return (response?.data ?? []).filter((event) => {
      if (query && !event.transaction_hash.toUpperCase().includes(query)) return false
      if (transactionType && event.transaction_type.toUpperCase() !== transactionType) return false
      if (resultCode && event.result_code.toUpperCase() !== resultCode) return false
      if (epochId && event.epoch_id.toUpperCase() !== epochId) return false
      if (from !== null && event.close_time < from) return false
      if (to !== null && event.close_time > to) return false
      return true
    })
  }, [filters, response])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Monitor</p>
          <h1>Protocol Activity</h1>
          <p className="page-summary">
            Indexed Lending transactions from committed validated Devnet ledgers, with direct links to normalized change detail.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href="/api/activity?limit=100">Activity JSON</a>
        </div>
      </header>

      <Panel title="Filter Activity" description="Filters apply to the latest bounded 100-event API window">
        <form
          className="activity-filter-form"
          onSubmit={(event) => {
            event.preventDefault()
            const next = {
              ...draft,
              query: draft.query.trim(),
              transactionType: draft.transactionType.trim(),
              resultCode: draft.resultCode.trim(),
              epochId: draft.epochId.trim(),
            }
            setFilters(next)
            setPage(0)
            saveFilters(next)
          }}
        >
          <label>
            <span>Transaction hash</span>
            <input
              value={draft.query}
              onChange={(event) => setDraft((value) => ({ ...value, query: event.target.value }))}
              placeholder="64-character hash or fragment"
              maxLength={128}
            />
          </label>
          <label>
            <span>Transaction type</span>
            <input
              value={draft.transactionType}
              onChange={(event) => setDraft((value) => ({ ...value, transactionType: event.target.value }))}
              placeholder="LoanSet"
              maxLength={64}
            />
          </label>
          <label>
            <span>Result</span>
            <input
              value={draft.resultCode}
              onChange={(event) => setDraft((value) => ({ ...value, resultCode: event.target.value }))}
              placeholder="tesSUCCESS"
              maxLength={64}
            />
          </label>
          <label>
            <span>Epoch</span>
            <input
              value={draft.epochId}
              onChange={(event) => setDraft((value) => ({ ...value, epochId: event.target.value }))}
              placeholder="epoch identifier"
              maxLength={128}
            />
          </label>
          <label>
            <span>From (UTC)</span>
            <input
              type="datetime-local"
              value={draft.fromUtc}
              onChange={(event) => setDraft((value) => ({ ...value, fromUtc: event.target.value }))}
            />
          </label>
          <label>
            <span>To (UTC)</span>
            <input
              type="datetime-local"
              value={draft.toUtc}
              onChange={(event) => setDraft((value) => ({ ...value, toUtc: event.target.value }))}
            />
          </label>
          <button className="primary-button" type="submit">Apply</button>
        </form>
      </Panel>

      <div className="activity-scope-note" role="note">
        <strong>Bounded collection</strong>
        <span>Object, account, and affected-node relationships are shown on transaction detail. The collection API currently returns the latest bounded window.</span>
      </div>

      {resource.state === 'loading' ? <LoadingBlock label="Loading indexed Activity" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response ? (
        <Panel
          title="Indexed transactions"
          description={`${formatInteger(filtered.length)} matching event(s) in a ${formatInteger(response.page.limit)}-event API window`}
          action={<ProvenanceBadge value="indexed" />}
        >
          {filtered.length === 0 ? (
            <EmptyBlock message="No indexed protocol events matched the current filters." />
          ) : (
            <div className="activity-card-list" aria-label="Protocol Activity results">
              {visible.map((event) => {
                const closeTime = rippleTimeToIso(event.close_time)
                return (
                  <article className="activity-card" key={`${event.transaction_hash}:${event.event_index}`}>
                    <div className="activity-card-main">
                      <div className="activity-card-heading">
                        <StatusBadge value={event.transaction_type} />
                        <StatusBadge value={event.result_code} />
                        <ProvenanceBadge value={event.provenance} />
                      </div>
                      <a
                        className="identifier-link mono activity-hash"
                        href={`/transactions/${event.transaction_hash}`}
                        title={event.transaction_hash}
                        onClick={(clickEvent) => {
                          clickEvent.preventDefault()
                          onNavigate(`/transactions/${event.transaction_hash}`)
                        }}
                      >{truncateMiddle(event.transaction_hash, 12)}</a>
                    </div>
                    <dl className="activity-card-facts">
                      <div><dt>Time (UTC)</dt><dd>{formatUtc(closeTime)}</dd></div>
                      <div><dt>Ledger</dt><dd className="mono">{formatInteger(event.ledger_index)}</dd></div>
                      <div><dt>Event index</dt><dd>{formatInteger(event.event_index)}</dd></div>
                      <div><dt>Epoch</dt><dd className="mono">{event.epoch_id}</dd></div>
                    </dl>
                  </article>
                )
              })}
            </div>
          )}

          <div className="pagination-bar">
            <span>Page {formatInteger(safePage + 1)} of {formatInteger(pageCount)}</span>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >Previous</button>
              <button
                className="secondary-button"
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              >Next</button>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title="Exports and feed" description="Bounded machine-readable Activity outputs">
        <div className="activity-export-links">
          <a href="/api/exports/activity?format=json&limit=100">JSON export</a>
          <a href="/api/exports/activity?format=ndjson&limit=100">NDJSON export</a>
          <a href="/api/exports/activity?format=csv&limit=100">CSV export</a>
          <a href="/api/feeds/activity.ndjson?limit=100">NDJSON feed</a>
        </div>
      </Panel>
    </div>
  )
}
