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

interface OverviewWatermark {
  source: string
  ledger_index: number
  ledger_hash: string
  updated_at: string
}

function snapshotProvenance(resources: DashboardResources): Provenance {
  return resources.overview.state === 'ready' && resources.overview.data.snapshot
    ? 'direct'
    : 'unavailable'
}

function ageSeconds(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, (Date.now() - timestamp) / 1000)
}

function currentStateStatus(age: number | null): 'healthy' | 'delayed' | 'stale' | 'unavailable' {
  if (age === null) return 'unavailable'
  if (age <= 10 * 60) return 'healthy'
  if (age <= 30 * 60) return 'delayed'
  return 'stale'
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
  const extendedOverview = overview as (typeof overview & {
    current_state_watermark?: OverviewWatermark | null
    counts_watermark?: OverviewWatermark | null
  }) | null
  const currentWatermark = extendedOverview?.current_state_watermark ?? null
  const countsWatermark = extendedOverview?.counts_watermark ?? null
  const currentAge = ageSeconds(currentWatermark?.updated_at)
  const countsAge = ageSeconds(countsWatermark?.updated_at)
  const currentStatus = currentStateStatus(currentAge)
  const indexedCountDetail = countsProvenance === 'unavailable'
    ? unavailableReason
    : countsWatermark
      ? `Indexed through ledger ${formatInteger(countsWatermark.ledger_index)}`
      : 'Indexed snapshot count'

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

      <Panel
        title="Current-state freshness"
        description="Five-minute current object state is separate from indexed counts and historical records"
      >
        {currentStatus !== 'healthy' ? (
          <div className="stale-warning" role="status">
            <strong>Current-state data is not within the ten-minute freshness window</strong>
            <span>The five-minute layer last updated {formatDuration(currentAge)} ago.</span>
          </div>
        ) : null}
        <DefinitionGrid
          items={[
            { label: 'Current state', value: <StatusBadge value={currentStatus} /> },
            { label: 'Current-state ledger', value: formatInteger(currentWatermark?.ledger_index), mono: true },
            { label: 'Current-state age', value: formatDuration(currentAge) },
            { label: 'Current-state updated', value: formatUtc(currentWatermark?.updated_at), wide: true },
            { label: 'Indexed counts ledger', value: formatInteger(countsWatermark?.ledger_index), mono: true },
            { label: 'Indexed counts age', value: formatDuration(countsAge) },
            { label: 'Indexed counts updated', value: formatUtc(countsWatermark?.updated_at), wide: true },
          ]}
        />
      </Panel>

      <section className="metrics-grid" aria-label="Indexed protocol counts">
        <MetricCard
          label="Vaults"
          value={formatInteger(overview?.counts.vaults)}
          detail={indexedCountDetail}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Loan Brokers"
          value={formatInteger(overview?.counts.loan_brokers)}
          detail={indexedCountDetail}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Loans"
          value={formatInteger(overview?.counts.loans)}
          detail={indexedCountDetail}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Indexed objects"
          value={formatInteger(overview?.counts.current_objects)}
          detail={indexedCountDetail}
          provenance={countsProvenance}
        />
        <MetricCard
          label="Current-state base"
          value={overview?.snapshot ? 'Available' : 'Unavailable'}
          detail={
            overview?.snapshot
              ? `Base ledger ${formatInteger(overview.snapshot.ledger_index)}`
              : unavailableReason
          }
          provenance={snapshotProvenance(resources)}
        />
      </section>

      <div className="overview-grid">
        <Panel
          title="Indexed history and network"
          description="Canonical history indexing status; separate from the five-minute current state"
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
                  <strong>Indexed history is stale</strong>
                  <span>Last successful history update was {formatDuration(status.collector.data_age_seconds)} ago.</span>
                </div>
              ) : null}
              <DefinitionGrid
                items={[
                  { label: 'History indexer', value: <StatusBadge value={status.collector.status} /> },
                  { label: 'Server state', value: status.server.state ? <StatusBadge value={status.server.state} /> : 'Unavailable' },
                  { label: 'Observed at history run', value: formatInteger(status.server.latest_validated_ledger), mono: true },
                  { label: 'History processed through', value: formatInteger(status.collector.last_processed_ledger), mono: true },
                  { label: 'Observed ledger age', value: formatDuration(status.server.latest_ledger_age_seconds) },
                  { label: 'History index age', value: formatDuration(status.collector.data_age_seconds) },
                  { label: 'History last success', value: formatUtc(status.collector.last_success_at), wide: true },
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
        description="Indexed history events; this panel may trail the five-minute current-state layer"
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
