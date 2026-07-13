import { useState } from 'react'

import { EmptyBlock, ErrorBlock, LoadingBlock, Panel, ProvenanceBadge, StatusBadge } from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { BalanceHistoryRecord, BalanceHistoryResponse } from '../types/api'

interface CoverLossAuditPageProps {
  onNavigate: (path: string) => void
}

interface Filters {
  metricType: string
  subjectType: string
  subjectId: string
  assetKey: string
}

const METRICS = ['', 'debt_total', 'debt_maximum', 'cover_available', 'loss_unrealized', 'required_minimum_cover', 'cover_surplus']
const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800
const PAGE_SIZE = 25

function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search)
  return {
    metricType: params.get('metric_type') ?? '',
    subjectType: params.get('subject_type') ?? '',
    subjectId: params.get('subject_id') ?? '',
    assetKey: params.get('asset_key') ?? '',
  }
}

function rippleTimeToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null
  return new Date((value + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function coverLossUrl(filters: Filters): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (filters.metricType) params.set('metric_type', filters.metricType)
  if (filters.subjectType) params.set('subject_type', filters.subjectType)
  if (filters.subjectId) params.set('subject_id', filters.subjectId)
  if (filters.assetKey) params.set('asset_key', filters.assetKey)
  return `/api/audit/cover-loss?${params.toString()}`
}

function saveFilters(filters: Filters): void {
  const params = new URLSearchParams()
  if (filters.metricType) params.set('metric_type', filters.metricType)
  if (filters.subjectType) params.set('subject_type', filters.subjectType)
  if (filters.subjectId) params.set('subject_id', filters.subjectId)
  if (filters.assetKey) params.set('asset_key', filters.assetKey)
  const suffix = params.toString()
  window.history.replaceState({}, '', suffix ? `/audit/cover-loss?${suffix}` : '/audit/cover-loss')
}

function metricLabel(metric: string): string {
  return metric.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function valueWithAsset(value: string | null, assetKey: string | null): string {
  if (value === null) return 'Unavailable'
  return assetKey ? `${value} ${assetKey}` : value
}

function subjectPath(record: BalanceHistoryRecord): string {
  return record.subject_type === 'Vault' ? `/vaults/${record.subject_id}` : `/loan-brokers/${record.subject_id}`
}

export function CoverLossAuditPage({ onNavigate }: CoverLossAuditPageProps) {
  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [filters, setFilters] = useState<Filters>(draft)
  const { resource, reload } = useApiResource<BalanceHistoryResponse>(coverLossUrl(filters))
  const response = resource.state === 'ready' ? resource.data : null
  const records = response?.data ?? []

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Audit</p>
          <h1>Cover &amp; Loss</h1>
          <p className="page-summary">
            Asset-separated Broker and Vault debt, cover, and loss history from indexed object changes. Unlike assets are never aggregated.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="secondary-button developer-action" href={coverLossUrl(filters)}>Cover JSON</a>
        </div>
      </header>

      <div className="activity-scope-note" role="note">
        <strong>Formula boundary</strong>
        <span>Required minimum cover and cover surplus appear only when indexed source fields are present. Missing inputs remain unavailable.</span>
      </div>

      <Panel title="Filter cover and loss history" description={`Filters apply to the latest bounded ${PAGE_SIZE}-row cover/debt/loss API window`}>
        <form
          className="activity-filter-form audit-filter-wide"
          onSubmit={(event) => {
            event.preventDefault()
            const next = {
              metricType: draft.metricType,
              subjectType: draft.subjectType,
              subjectId: draft.subjectId.trim(),
              assetKey: draft.assetKey.trim(),
            }
            setFilters(next)
            saveFilters(next)
          }}
        >
          <label>
            <span>Metric</span>
            <select value={draft.metricType} onChange={(event) => setDraft((value) => ({ ...value, metricType: event.target.value }))}>
              {METRICS.map((metric) => <option key={metric || 'all'} value={metric}>{metric ? metricLabel(metric) : 'All metrics'}</option>)}
            </select>
          </label>
          <label>
            <span>Subject type</span>
            <select value={draft.subjectType} onChange={(event) => setDraft((value) => ({ ...value, subjectType: event.target.value }))}>
              <option value="">All subjects</option>
              <option value="Vault">Vault</option>
              <option value="LoanBroker">Loan Broker</option>
            </select>
          </label>
          <label>
            <span>Subject ID</span>
            <input value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))} maxLength={128} placeholder="Exact Vault or Broker ID" />
          </label>
          <label>
            <span>Asset key</span>
            <input value={draft.assetKey} onChange={(event) => setDraft((value) => ({ ...value, assetKey: event.target.value }))} maxLength={128} placeholder="Exact asset key" />
          </label>
          <button className="primary-button" type="submit">Apply</button>
        </form>
      </Panel>

      {resource.state === 'loading' ? <LoadingBlock label="Loading cover and loss history" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response ? (
        <Panel
          title="Indexed cover and loss events"
          description={`${formatInteger(records.length)} row(s) returned · latest bounded ${PAGE_SIZE}-row window`}
          action={<ProvenanceBadge value={response.provenance.collection} />}
        >
          {records.length === 0 ? (
            <EmptyBlock message="No cover, debt, or loss history matched the current filters." />
          ) : (
            <div className="activity-card-list" aria-label="Cover and loss history">
              {records.map((record) => (
                <article className="activity-card" key={`${record.subject_id}:${record.transaction_hash}:${record.metric_type}`}>
                  <div className="activity-card-main">
                    <div className="activity-card-heading">
                      <StatusBadge value={metricLabel(record.metric_type)} />
                      <StatusBadge value={record.subject_type} />
                      <ProvenanceBadge value={record.provenance} />
                    </div>
                    <a
                      className="identifier-link mono activity-hash"
                      href={subjectPath(record)}
                      title={record.subject_id}
                      onClick={(click) => {
                        click.preventDefault()
                        onNavigate(subjectPath(record))
                      }}
                    >{truncateMiddle(record.subject_id, 12)}</a>
                  </div>
                  <dl className="activity-card-facts">
                    <div><dt>Before</dt><dd className="mono">{valueWithAsset(record.before_value, record.asset_key)}</dd></div>
                    <div><dt>After</dt><dd className="mono">{valueWithAsset(record.after_value, record.asset_key)}</dd></div>
                    <div><dt>Asset</dt><dd>{record.asset_key ?? 'Unavailable'}</dd></div>
                    <div><dt>Ledger</dt><dd className="mono">{formatInteger(record.ledger_index)}</dd></div>
                    <div><dt>Close time</dt><dd>{formatUtc(rippleTimeToIso(record.close_time))}</dd></div>
                    <div>
                      <dt>Transaction</dt>
                      <dd>
                        <a href={`/transactions/${record.transaction_hash}`} onClick={(click) => { click.preventDefault(); onNavigate(`/transactions/${record.transaction_hash}`) }}>
                          {truncateMiddle(record.transaction_hash, 10)}
                        </a>
                      </dd>
                    </div>
                  </dl>
                  {record.formula ? <p className="lifecycle-change-summary">{record.formula}</p> : null}
                  <details>
                    <summary>Formula inputs and provenance</summary>
                    <pre className="raw-data-panel"><code>{JSON.stringify(record.source_fields_json, null, 2)}</code></pre>
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
