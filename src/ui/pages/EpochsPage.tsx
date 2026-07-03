import { EmptyBlock, ErrorBlock, LoadingBlock, Panel, ProvenanceBadge, StatusBadge } from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { EpochsResponse } from '../types/api'

interface EpochsPageProps {
  onNavigate: (path: string) => void
}

export function EpochsPage({ onNavigate }: EpochsPageProps) {
  const { resource, reload } = useApiResource<EpochsResponse>('/api/epochs')
  const response = resource.state === 'ready' ? resource.data : null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Audit</p>
          <h1>Devnet Epochs</h1>
          <p className="page-summary">
            Reset boundaries for collected Devnet history. Records from different epochs are never silently combined.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href="/api/epochs">Epoch JSON</a>
        </div>
      </header>

      <div className="activity-scope-note" role="note">
        <strong>Epoch boundary</strong>
        <span>Archived epochs preserve historical evidence after Devnet resets; current-state objects remain unavailable until a verified active snapshot is activated.</span>
      </div>

      {resource.state === 'loading' ? <LoadingBlock label="Loading Devnet epochs" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response ? (
        <Panel title="Indexed epochs" description={`${formatInteger(response.data.length)} epoch(s) returned`} action={<ProvenanceBadge value="direct" />}>
          {response.data.length === 0 ? (
            <EmptyBlock message="No Devnet epochs have been indexed yet." />
          ) : (
            <div className="activity-card-list" aria-label="Devnet epoch results">
              {response.data.map((epoch) => (
                <article className="activity-card" key={epoch.id}>
                  <div className="activity-card-main">
                    <div className="activity-card-heading">
                      <StatusBadge value={epoch.status} />
                      <ProvenanceBadge value={epoch.provenance} />
                    </div>
                    <a
                      className="identifier-link mono activity-hash"
                      href={`/epochs/${encodeURIComponent(epoch.id)}`}
                      title={epoch.id}
                      onClick={(click) => {
                        click.preventDefault()
                        onNavigate(`/epochs/${encodeURIComponent(epoch.id)}`)
                      }}
                    >{truncateMiddle(epoch.id, 12)}</a>
                  </div>
                  <dl className="activity-card-facts">
                    <div><dt>First ledger</dt><dd className="mono">{formatInteger(epoch.first_ledger_index)}</dd></div>
                    <div><dt>Last ledger</dt><dd className="mono">{formatInteger(epoch.last_ledger_index)}</dd></div>
                    <div><dt>Started</dt><dd>{formatUtc(epoch.started_at)}</dd></div>
                    <div><dt>Reset reason</dt><dd>{epoch.reset_reason ?? 'Unavailable'}</dd></div>
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
