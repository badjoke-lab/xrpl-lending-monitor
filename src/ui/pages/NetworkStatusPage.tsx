import {
  DefinitionGrid,
  ErrorBlock,
  LoadingBlock,
  Panel,
  StatusBadge,
  UnavailableBlock,
} from '../components/DataDisplay'
import { booleanLabel, formatDuration, formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { ResourceState, NetworkStatusResponse } from '../types/api'

interface NetworkStatusPageProps {
  status: ResourceState<NetworkStatusResponse>
  onReload: () => void
}

export function NetworkStatusPage({ status, onReload }: NetworkStatusPageProps) {
  const data = status.state === 'ready' ? status.data : null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">System</p>
          <h1>Network Status</h1>
          <p className="page-summary">
            Public operational context for the read-only Devnet collector and its current epoch.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={onReload}>
            Refresh data
          </button>
          <a className="primary-button" href="/api/status">
            Status JSON
          </a>
        </div>
      </header>

      {status.state === 'loading' ? <LoadingBlock label="Loading network status" /> : null}
      {status.state === 'error' ? <ErrorBlock message={status.error} onRetry={onReload} /> : null}
      {data && !data.epoch ? (
        <UnavailableBlock
          title="Current epoch unavailable"
          reason="The status API has not reported a current Devnet epoch. Other server and collector facts remain visible below."
        />
      ) : null}

      {data ? (
        <>
          {data.collector.status === 'stale' ? (
            <div className="stale-warning stale-warning-page" role="status">
              <strong>Collector data is stale</strong>
              <span>
                Last successful collection was {formatDuration(data.collector.data_age_seconds)} ago.
              </span>
            </div>
          ) : null}

          {data.collector.error ? (
            <div className="state-block state-error" role="alert">
              <span className="state-symbol" aria-hidden="true">!</span>
              <div>
                <strong>{data.collector.error.code}</strong>
                <p>{data.collector.error.message}</p>
              </div>
            </div>
          ) : null}

          <section className="status-summary-grid" aria-label="Network status summary">
            <article className="status-summary-card">
              <span>Collector</span>
              <StatusBadge value={data.collector.status} />
              <small>{formatInteger(data.collector.consecutive_failures)} consecutive failures</small>
            </article>
            <article className="status-summary-card">
              <span>Server</span>
              {data.server.state ? <StatusBadge value={data.server.state} /> : <strong>Unavailable</strong>}
              <small>{data.server.version ?? 'Version unavailable'}</small>
            </article>
            <article className="status-summary-card">
              <span>Validated ledger</span>
              <strong className="mono">{formatInteger(data.server.latest_validated_ledger)}</strong>
              <small>{formatDuration(data.server.latest_ledger_age_seconds)} old</small>
            </article>
            <article className="status-summary-card">
              <span>Epoch</span>
              <strong className="mono">{data.epoch?.id ?? 'Unavailable'}</strong>
              <small>{data.epoch ? data.epoch.status : 'No current epoch'}</small>
            </article>
          </section>

          <div className="status-detail-grid">
            <Panel title="Server" description="Validated-ledger source reported by the status API">
              <DefinitionGrid
                items={[
                  { label: 'Network', value: data.network.toUpperCase() },
                  { label: 'State', value: data.server.state ? <StatusBadge value={data.server.state} /> : 'Unavailable' },
                  { label: 'Version', value: data.server.version ?? 'Unavailable' },
                  { label: 'Endpoint', value: data.server.endpoint ?? 'Unavailable', wide: true, mono: true },
                  { label: 'Complete ledgers', value: data.server.complete_ledgers ?? 'Unavailable', wide: true, mono: true },
                  { label: 'Validated ledger', value: formatInteger(data.server.latest_validated_ledger), mono: true },
                  { label: 'Ledger age', value: formatDuration(data.server.latest_ledger_age_seconds) },
                  {
                    label: 'Validated hash',
                    value: data.server.latest_validated_hash ? truncateMiddle(data.server.latest_validated_hash, 12) : 'Unavailable',
                    wide: true,
                    mono: true,
                  },
                ]}
              />
            </Panel>

            <Panel title="Collector" description="Committed cursor and collection health">
              <DefinitionGrid
                items={[
                  { label: 'Status', value: <StatusBadge value={data.collector.status} /> },
                  { label: 'Data age', value: formatDuration(data.collector.data_age_seconds) },
                  { label: 'Last processed ledger', value: formatInteger(data.collector.last_processed_ledger), mono: true },
                  { label: 'Failures', value: formatInteger(data.collector.consecutive_failures) },
                  { label: 'Last attempt', value: formatUtc(data.collector.last_attempt_at), wide: true },
                  { label: 'Last success', value: formatUtc(data.collector.last_success_at), wide: true },
                  {
                    label: 'Processed hash',
                    value: data.collector.last_processed_hash ? truncateMiddle(data.collector.last_processed_hash, 12) : 'Unavailable',
                    wide: true,
                    mono: true,
                  },
                  { label: 'Reset reason', value: data.collector.reset_reason ?? 'None reported', wide: true },
                ]}
              />
            </Panel>

            <Panel title="Current epoch" description="Network reset and historical isolation boundary">
              {data.epoch ? (
                <DefinitionGrid
                  items={[
                    { label: 'Epoch ID', value: data.epoch.id, mono: true },
                    { label: 'Status', value: <StatusBadge value={data.epoch.status} /> },
                    { label: 'First ledger', value: formatInteger(data.epoch.first_ledger_index), mono: true },
                    { label: 'Last ledger', value: formatInteger(data.epoch.last_ledger_index), mono: true },
                    { label: 'Started', value: formatUtc(data.epoch.started_at), wide: true },
                    {
                      label: 'First hash',
                      value: truncateMiddle(data.epoch.first_ledger_hash, 12),
                      wide: true,
                      mono: true,
                    },
                    {
                      label: 'Last hash',
                      value: data.epoch.last_ledger_hash ? truncateMiddle(data.epoch.last_ledger_hash, 12) : 'Unavailable',
                      wide: true,
                      mono: true,
                    },
                  ]}
                />
              ) : (
                <UnavailableBlock reason="No epoch record is available from the status API." />
              )}
            </Panel>

            <Panel title="Amendments" description="Enabled and supported are separate protocol facts">
              <div className="amendment-status-table">
                <div className="amendment-status-row amendment-status-head">
                  <span>Amendment</span>
                  <span>Enabled</span>
                  <span>Supported</span>
                </div>
                <div className="amendment-status-row">
                  <strong>Lending Protocol</strong>
                  <span>{booleanLabel(data.amendments.lending_protocol.enabled)}</span>
                  <span>{booleanLabel(data.amendments.lending_protocol.supported)}</span>
                </div>
                <div className="amendment-status-row">
                  <strong>Single Asset Vault</strong>
                  <span>{booleanLabel(data.amendments.single_asset_vault.enabled)}</span>
                  <span>{booleanLabel(data.amendments.single_asset_vault.supported)}</span>
                </div>
              </div>
            </Panel>
          </div>

          <div className="method-note">
            <strong>Interpretation boundary</strong>
            <p>
              This page reports the status API as fact. It does not infer Mainnet readiness, protocol safety,
              availability guarantees, or investment conclusions.
            </p>
          </div>
        </>
      ) : null}
    </div>
  )
}
