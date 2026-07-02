import { useState } from 'react'

import { EmptyBlock, ErrorBlock, LoadingBlock, Panel, ProvenanceBadge, StatusBadge } from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { ArchivedObjectsResponse } from '../types/api'

interface ArchivedObjectsPageProps {
  onNavigate: (path: string) => void
}

interface Filters {
  objectType: string
  query: string
}

const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search)
  return {
    objectType: params.get('object_type') ?? '',
    query: params.get('q') ?? '',
  }
}

function archiveUrl(filters: Filters): string {
  const params = new URLSearchParams({ limit: '100' })
  if (filters.objectType) params.set('object_type', filters.objectType)
  if (filters.query) params.set('q', filters.query)
  return `/api/audit/archived?${params.toString()}`
}

function saveFilters(filters: Filters): void {
  const params = new URLSearchParams()
  if (filters.objectType) params.set('object_type', filters.objectType)
  if (filters.query) params.set('q', filters.query)
  window.history.replaceState({}, '', params.toString() ? `/audit/archived?${params.toString()}` : '/audit/archived')
}

function rippleTimeToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null
  return new Date((value + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

export function ArchivedObjectsPage({ onNavigate }: ArchivedObjectsPageProps) {
  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [filters, setFilters] = useState<Filters>(draft)
  const { resource, reload } = useApiResource<ArchivedObjectsResponse>(archiveUrl(filters))
  const response = resource.state === 'ready' ? resource.data : null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Audit</p>
          <h1>Archived Objects</h1>
          <p className="page-summary">
            Deleted Vault, Loan Broker, and Loan records preserved from indexed DeletedNode evidence. Archived records are not current objects.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={archiveUrl(filters)}>Archive JSON</a>
        </div>
      </header>

      <div className="archive-banner" role="note">
        <strong>Archived context</strong>
        <span>These records left current projections and remain searchable as historical evidence. Unknown deletion classifications remain unknown.</span>
      </div>

      <Panel title="Filter archived objects" description="Filters apply to the latest bounded 100 archived-object API window">
        <form
          className="activity-filter-form"
          onSubmit={(event) => {
            event.preventDefault()
            const next = { objectType: draft.objectType, query: draft.query.trim() }
            setFilters(next)
            saveFilters(next)
          }}
        >
          <label>
            <span>Object type</span>
            <select value={draft.objectType} onChange={(event) => setDraft((value) => ({ ...value, objectType: event.target.value }))}>
              <option value="">All archived objects</option>
              <option value="Vault">Vault</option>
              <option value="LoanBroker">Loan Broker</option>
              <option value="Loan">Loan</option>
            </select>
          </label>
          <label>
            <span>Exact identifier</span>
            <input
              value={draft.query}
              onChange={(event) => setDraft((value) => ({ ...value, query: event.target.value }))}
              placeholder="Object, transaction, account, or asset key"
              maxLength={128}
            />
          </label>
          <button className="primary-button" type="submit">Apply</button>
        </form>
      </Panel>

      {resource.state === 'loading' ? <LoadingBlock label="Loading archived objects" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response ? (
        <Panel
          title="Indexed archives"
          description={`${formatInteger(response.data.length)} archived object(s) returned from the bounded API`}
          action={<ProvenanceBadge value={response.provenance.collection} />}
        >
          {response.data.length === 0 ? (
            <EmptyBlock message="No archived objects matched the current filters." />
          ) : (
            <div className="activity-card-list" aria-label="Archived object results">
              {response.data.map((archive) => (
                <article className="activity-card" key={`${archive.object_type}:${archive.object_id}`}>
                  <div className="activity-card-main">
                    <div className="activity-card-heading">
                      <StatusBadge value="archived" />
                      <StatusBadge value={archive.object_type} />
                      <StatusBadge value={archive.deletion_reason} />
                      <ProvenanceBadge value={archive.provenance} />
                    </div>
                    <a
                      className="identifier-link mono activity-hash"
                      href={`/audit/archived/${archive.object_type}/${archive.object_id}`}
                      title={archive.object_id}
                      onClick={(click) => {
                        click.preventDefault()
                        onNavigate(`/audit/archived/${archive.object_type}/${archive.object_id}`)
                      }}
                    >{truncateMiddle(archive.object_id, 12)}</a>
                  </div>
                  <dl className="activity-card-facts">
                    <div><dt>Deleted at</dt><dd>{formatUtc(rippleTimeToIso(archive.deletion_close_time))}</dd></div>
                    <div><dt>Ledger</dt><dd className="mono">{formatInteger(archive.deletion_ledger_index)}</dd></div>
                    <div><dt>Epoch</dt><dd className="mono">{archive.epoch_id}</dd></div>
                    <div><dt>Asset</dt><dd>{archive.relationships.asset_key ?? 'Unavailable'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  )
}
