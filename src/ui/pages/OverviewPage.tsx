import { rippleEpochToIso } from '../../domain/time/ripple-epoch'

import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  MetricCard,
  Panel,
  ProvenanceBadge,
  StatusBadge,
  UnavailableBlock,
  DefinitionGrid,
} from '../components/DataDisplay'
import { formatDuration, formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { DashboardResources, Provenance } from '../types/api'

interface OverviewPageProps {
  resources: DashboardResources
  onNavigate: (path: string) => void
  onReload: () => void
}

function snapshotProvenance(resources: DashboardResources): Provenance {
  return resources.overview.state === 'ready' && resources.overview.data.snapshot
    ? 'direct'
    : 'unavailable'
}

export function OverviewPage({ resources, onNavigate, onReload }: OverviewPageProps) {
  const overview = resources.overview.state === 'ready' ? resources.overview.data : null
  const status = resources.status.state === 'ready' ? resources.status.data : null
  const activity = resources.activity.state === 'ready' ? resources.activity.data.data : []
  const countsProvenance = overview?.provenance.counts ?? 'unavailable'
  const unavailableReason = overview?.unavailable[0] ?? 'Current-state availability has not been reported.'
  const partialFailure = [resources.status, resources.overview, resources.activity].some(
    (resource) => resource.state === 'error',
  )

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Protocol overview</p>
          <h1>XRPL Lending Monitor</h1>
          <p className="page-summary">
            Read-only Devnet monitoring with explicit current-state, history, freshness, and provenance boundaries.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={onReload}>
            Refresh data
          </button>
          <a className="primary-button" href="/api/overview">
            Overview JSON
          </a>
        </div>
      </header>

      {partialFailure ? (
        <div className="partial-warning" role="status">
          <strong>Partial data</strong>
          <span>One or more API panels could not be loaded. Successful panels remain visible.</span>
        </div>
      ) : null}

      <section className="metrics-grid" aria-label="Current protocol counts">
        <MetricCard
          label="Vaults"
          value={formatInteger(overview?.counts.vaults)}
          detail={countsProvenance === 'unavailable' ? unavailableReason : 'Active snapshot count'}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Loan Brokers"
          value={formatInteger(overview?.counts.loan_brokers)}
          detail={countsProvenance === 'unavailable' ? unavailableReason : 'Active snapshot count'}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Loans"
          value={formatInteger(overview?.counts.loans)}
          detail={countsProvenance === 'unavailable' ? unavailableReason : 'Active snapshot count'}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Current objects"
          value={formatInteger(overview?.counts.current_objects)}
          detail={countsProvenance === 'unavailable' ? unavailableReason : 'Vault, Broker, and Loan objects'}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Active snapshot"
          value={overview?.snapshot ? 'Active' : 'Unavailable'}
          detail={
            overview?.snapshot
              ? `Ledger ${formatInteger(overview.snapshot.ledger_index)}`
              : unavailableReason
          }
          provenance={snapshotProvenance(resources)}
        />
      </section>

      <div className="overview-grid">
        <Panel
          title="Collector and network"
          description="Latest committed operational context"
          action={
            <a
              href="/network-status"
              onClick={(event) => {
                event.preventDefault()
                onNavigate('/network-status')
              }}
            >
              Full status
            </a>
          }
        >
          {resources.status.state === 'loading' ? <LoadingBlock label="Loading network status" /> : null}
          {resources.status.state === 'error' ? (
            <ErrorBlock message={resources.status.error} onRetry={onReload} />
          ) : null}
          {status ? (
            <>
              {status.collector.status === 'stale' ? (
                <div className="stale-warning" role="status">
                  <strong>Stale collector data</strong>
                  <span>Last successful update was {formatDuration(status.collector.data_age_seconds)} ago.</span>
                </div>
              ) : null}
              <DefinitionGrid
                items={[
                  { label: 'Collector', value: <StatusBadge value={status.collector.status} /> },
                  { label: 'Server state', value: status.server.state ? <StatusBadge value={status.server.state} /> : 'Unavailable' },
                  { label: 'Validated ledger', value: formatInteger(status.server.latest_validated_ledger), mono: true },
                  { label: 'Processed ledger', value: formatInteger(status.collector.last_processed_ledger), mono: true },
                  { label: 'Ledger age', value: formatDuration(status.server.latest_ledger_age_seconds) },
                  { label: 'Data age', value: formatDuration(status.collector.data_age_seconds) },
                  { label: 'Last success', value: formatUtc(status.collector.last_success_at), wide: true },
                  { label: 'Failures', value: formatInteger(status.collector.consecutive_failures) },
                ]}
              />
            </>
          ) : null}
        </Panel>

        <Panel title="Protocol amendments" description="Enabled and supported are reported separately">
          {resources.status.state === 'loading' ? <LoadingBlock label="Loading amendment status" /> : null}
          {resources.status.state === 'error' ? (
            <ErrorBlock message={resources.status.error} onRetry={onReload} />
          ) : null}
          {status ? (
            <div className="amendment-list">
              <article>
                <div>
                  <h3>Lending Protocol</h3>
                  <p>Protocol amendment state from the monitored server.</p>
                </div>
                <div className="amendment-states">
                  <span>Enabled: {status.amendments.lending_protocol.enabled === null ? 'Unavailable' : status.amendments.lending_protocol.enabled ? 'Yes' : 'No'}</span>
                  <span>Supported: {status.amendments.lending_protocol.supported === null ? 'Unavailable' : status.amendments.lending_protocol.supported ? 'Yes' : 'No'}</span>
                </div>
              </article>
              <article>
                <div>
                  <h3>Single Asset Vault</h3>
                  <p>Vault amendment state from the monitored server.</p>
                </div>
                <div className="amendment-states">
                  <span>Enabled: {status.amendments.single_asset_vault.enabled === null ? 'Unavailable' : status.amendments.single_asset_vault.enabled ? 'Yes' : 'No'}</span>
                  <span>Supported: {status.amendments.single_asset_vault.supported === null ? 'Unavailable' : status.amendments.single_asset_vault.supported ? 'Yes' : 'No'}</span>
                </div>
              </article>
            </div>
          ) : null}
        </Panel>
      </div>

      {resources.overview.state === 'loading' ? <LoadingBlock label="Loading current-state availability" /> : null}
      {resources.overview.state === 'error' ? (
        <ErrorBlock message={resources.overview.error} onRetry={onReload} />
      ) : null}
      {overview && overview.unavailable.length > 0 ? (
        <UnavailableBlock title="Current-state snapshot unavailable" reason={overview.unavailable.join(' ')} />
      ) : null}

      <Panel
        title="Recent protocol activity"
        description="Indexed events from committed validated ledgers"
        className="activity-panel"
        action={<a href="/api/activity?limit=20">Activity API</a>}
      >
        {resources.activity.state === 'loading' ? <LoadingBlock label="Loading indexed activity" /> : null}
        {resources.activity.state === 'error' ? (
          <ErrorBlock message={resources.activity.error} onRetry={onReload} />
        ) : null}
        {resources.activity.state === 'ready' && activity.length === 0 ? (
          <EmptyBlock message="No indexed protocol events are available for this query." />
        ) : null}
        {activity.length > 0 ? (
          <div className="table-scroll" tabIndex={0} aria-label="Recent protocol activity table">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Ledger</th>
                  <th scope="col">Type</th>
                  <th scope="col">Result</th>
                  <th scope="col">Transaction</th>
                  <th scope="col">Provenance</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((event) => (
                  <tr key={`${event.transaction_hash}:${event.event_index}`}>
                    <td>{formatUtc(rippleEpochToIso(event.close_time))}</td>
                    <td className="mono">{formatInteger(event.ledger_index)}</td>
                    <td>{event.transaction_type}</td>
                    <td><StatusBadge value={event.result_code} /></td>
                    <td>
                      <a className="mono identifier-link" href={`/transactions/${event.transaction_hash}`} title={event.transaction_hash}>
                        {truncateMiddle(event.transaction_hash)}
                      </a>
                    </td>
                    <td><ProvenanceBadge value={event.provenance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <div className="overview-grid overview-grid-bottom">
        <Panel title="Devnet and epoch preservation" description="Reset-aware historical context">
          <div className="notice-content">
            <span className="notice-icon" aria-hidden="true">i</span>
            <div>
              <h3>Devnet can reset</h3>
              <p>
                Data is scoped by network and epoch so an archived epoch is not mixed with the current Devnet state.
              </p>
              <p>
                Current epoch: <strong className="mono">{status?.epoch?.id ?? 'Unavailable'}</strong>
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Provenance" description="How user-visible values are classified">
          <ul className="provenance-list">
            <li><ProvenanceBadge value="direct" /><span>Read from validated ledger or snapshot data.</span></li>
            <li><ProvenanceBadge value="derived" /><span>Calculated from direct values with a documented formula.</span></li>
            <li><ProvenanceBadge value="indexed" /><span>Reconstructed from committed historical records.</span></li>
            <li><ProvenanceBadge value="unavailable" /><span>Not available or not supported as fact.</span></li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}
