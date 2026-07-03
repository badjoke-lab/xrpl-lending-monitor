import { DefinitionGrid, EmptyBlock, ErrorBlock, LoadingBlock, Panel, ProvenanceBadge, StatusBadge } from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { EpochDetailResponse } from '../types/api'

interface EpochDetailPageProps {
  epochId: string
  onNavigate: (path: string) => void
}

function detailUrl(epochId: string): string {
  return `/api/epochs/${encodeURIComponent(epochId)}`
}

export function EpochDetailPage({ epochId, onNavigate }: EpochDetailPageProps) {
  const { resource, reload } = useApiResource<EpochDetailResponse>(detailUrl(epochId))
  const response = resource.state === 'ready' ? resource.data : null
  const epoch = response?.data ?? null
  const counts = response?.scoped_counts ?? null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Devnet epoch</p>
          <h1>{truncateMiddle(epochId, 12)}</h1>
          <p className="page-summary">
            Epoch-scoped evidence and reset boundary metadata. Counts are indexed facts, not cross-epoch totals.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={detailUrl(epochId)}>Epoch JSON</a>
        </div>
      </header>

      {resource.state === 'loading' ? <LoadingBlock label="Loading Devnet epoch" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}
      {response && !epoch ? <EmptyBlock message={response.availability.reason ?? 'Epoch was not found.'} /> : null}

      {epoch && response ? (
        <>
          <Panel title="Reset boundary" description="Direct epoch metadata from the collector state" action={<ProvenanceBadge value={response.provenance.epoch} />}>
            <DefinitionGrid
              items={[
                { label: 'Epoch ID', value: epoch.id, wide: true, mono: true },
                { label: 'Status', value: <StatusBadge value={epoch.status} /> },
                { label: 'First ledger', value: formatInteger(epoch.first_ledger_index), mono: true },
                { label: 'First hash', value: epoch.first_ledger_hash, wide: true, mono: true },
                { label: 'Last ledger', value: formatInteger(epoch.last_ledger_index), mono: true },
                { label: 'Last hash', value: epoch.last_ledger_hash ?? 'Unavailable', wide: true, mono: true },
                { label: 'Started', value: formatUtc(epoch.started_at) },
                { label: 'Ended', value: formatUtc(epoch.ended_at) },
                { label: 'Reset reason', value: epoch.reset_reason ?? 'Unavailable', wide: true },
              ]}
            />
          </Panel>

          <Panel title="Epoch-scoped indexed evidence" description="Counts are scoped to this epoch only" action={<ProvenanceBadge value={response.provenance.scoped_counts} />}>
            <dl className="transaction-summary-grid">
              <div><dt>Protocol events</dt><dd className="mono">{formatInteger(counts?.protocol_events)}</dd></div>
              <div><dt>Object changes</dt><dd className="mono">{formatInteger(counts?.object_changes)}</dd></div>
              <div><dt>Archives</dt><dd className="mono">{formatInteger(counts?.archived_objects)}</dd></div>
              <div><dt>Lifecycle events</dt><dd className="mono">{formatInteger(counts?.loan_lifecycle_events)}</dd></div>
              <div><dt>Cover/loss rows</dt><dd className="mono">{formatInteger(counts?.balance_history_rows)}</dd></div>
              <div><dt>Current objects</dt><dd>Unavailable</dd></div>
            </dl>
          </Panel>

          <Panel title="Provenance and cross-links" description="Audit routes keep Direct, Indexed, Derived, and Unavailable evidence separate">
            <div className="documentation-link-grid">
              <div><h3>Activity</h3><p>Indexed transaction events. Use epoch IDs to avoid mixing reset eras.</p><button type="button" onClick={() => onNavigate('/activity')}>Open Activity</button></div>
              <div><h3>Archives</h3><p>Deleted objects retained as indexed final-state evidence.</p><button type="button" onClick={() => onNavigate('/audit/archived')}>Open Archives</button></div>
              <div><h3>Cover formulas</h3><p>Derived rows expose formulas and source fields when available.</p><button type="button" onClick={() => onNavigate('/methodology#cover-formulas')}>Open Methodology</button></div>
              <div><h3>API contract</h3><p>Public routes disclose availability and provenance fields.</p><button type="button" onClick={() => onNavigate('/api')}>Open API</button></div>
            </div>
          </Panel>

          <div className="activity-scope-note" role="note">
            <strong>Unavailable current objects</strong>
            <span>{response.availability.current_objects}</span>
          </div>
        </>
      ) : null}
    </div>
  )
}
