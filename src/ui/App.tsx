import { useEffect, useMemo, useState } from 'react'

interface ApiStatus {
  network: 'devnet'
  epoch: {
    id: string
    status: string
    first_ledger_index: number
    last_ledger_index: number | null
  } | null
  server: {
    state: string | null
    latest_validated_ledger: number | null
    latest_ledger_age_seconds: number | null
  }
  amendments: {
    lending_protocol: { enabled: boolean | null; supported: boolean | null }
    single_asset_vault: { enabled: boolean | null; supported: boolean | null }
  }
  collector: {
    status: string
    last_processed_ledger: number | null
    last_success_at: string | null
    data_age_seconds: number | null
    consecutive_failures: number
    error: { code: string; message: string } | null
  }
}

interface Overview {
  network: 'devnet'
  counts: {
    vaults: number | null
    loan_brokers: number | null
    loans: number | null
    current_objects: number | null
  }
  freshness: {
    collector_status: string
    latest_validated_ledger: number | null
    last_processed_ledger: number | null
    last_success_at: string | null
  }
  unavailable: string[]
}

interface ActivityResponse {
  data: Array<{
    transaction_hash: string
    ledger_index: number
    transaction_type: string
    result_code: string
  }>
}

interface DashboardState {
  status: ApiStatus | null
  overview: Overview | null
  activity: ActivityResponse | null
  error: string | null
}

const emptyState: DashboardState = {
  status: null,
  overview: null,
  activity: null,
  error: null,
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unavailable' : value.toLocaleString()
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'Unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value))
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function App() {
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<DashboardState>(emptyState)

  useEffect(() => {
    let active = true

    Promise.all([
      fetchJson<ApiStatus>('/api/status'),
      fetchJson<Overview>('/api/overview'),
      fetchJson<ActivityResponse>('/api/activity?limit=5'),
    ])
      .then(([status, overview, activity]) => {
        if (!active) return
        setDashboard({ status, overview, activity, error: null })
      })
      .catch((error: unknown) => {
        if (!active) return
        setDashboard({
          ...emptyState,
          error: error instanceof Error ? error.message : 'API unavailable',
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const counts = dashboard.overview?.counts
  const activity = dashboard.activity?.data ?? []
  const statusTone = useMemo(() => {
    const collectorStatus = dashboard.status?.collector.status
    if (!collectorStatus) return 'muted'
    if (collectorStatus === 'healthy') return 'good'
    if (collectorStatus === 'stale') return 'warn'
    return 'bad'
  }, [dashboard.status])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Devnet read-only monitor</p>
          <h1>XRPL Lending Monitor</h1>
        </div>
        <div className={`status-pill ${statusTone}`}>
          {loading ? 'Loading' : dashboard.status?.collector.status ?? 'API unavailable'}
        </div>
      </header>

      <section className="summary-grid" aria-label="Protocol overview">
        <article className="metric-panel">
          <span>Vaults</span>
          <strong>{formatNumber(counts?.vaults)}</strong>
        </article>
        <article className="metric-panel">
          <span>Loan Brokers</span>
          <strong>{formatNumber(counts?.loan_brokers)}</strong>
        </article>
        <article className="metric-panel">
          <span>Loans</span>
          <strong>{formatNumber(counts?.loans)}</strong>
        </article>
        <article className="metric-panel">
          <span>Current Objects</span>
          <strong>{formatNumber(counts?.current_objects)}</strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <section className="panel" aria-labelledby="network-status">
          <div className="panel-heading">
            <h2 id="network-status">Network status</h2>
            <a href="/api/status">JSON</a>
          </div>
          <dl className="fact-list">
            <div>
              <dt>Network</dt>
              <dd>{dashboard.status?.network ?? 'devnet'}</dd>
            </div>
            <div>
              <dt>Epoch</dt>
              <dd>{dashboard.status?.epoch?.id ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Latest validated ledger</dt>
              <dd>{formatNumber(dashboard.status?.server.latest_validated_ledger)}</dd>
            </div>
            <div>
              <dt>Last processed ledger</dt>
              <dd>{formatNumber(dashboard.status?.collector.last_processed_ledger)}</dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>{formatTime(dashboard.status?.collector.last_success_at)}</dd>
            </div>
            <div>
              <dt>Collector failures</dt>
              <dd>{formatNumber(dashboard.status?.collector.consecutive_failures)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel" aria-labelledby="amendment-status">
          <div className="panel-heading">
            <h2 id="amendment-status">Amendments</h2>
          </div>
          <div className="amendment-grid">
            <div>
              <span>Lending Protocol</span>
              <strong>
                {dashboard.status?.amendments.lending_protocol.enabled === true
                  ? 'Enabled'
                  : 'Unavailable'}
              </strong>
            </div>
            <div>
              <span>Single Asset Vault</span>
              <strong>
                {dashboard.status?.amendments.single_asset_vault.enabled === true
                  ? 'Enabled'
                  : 'Unavailable'}
              </strong>
            </div>
          </div>
          <div className="notice-line">
            {dashboard.overview?.unavailable[0] ??
              dashboard.error ??
              'Current snapshot counts are direct when active.'}
          </div>
        </section>

        <section className="panel wide" aria-labelledby="recent-activity">
          <div className="panel-heading">
            <h2 id="recent-activity">Recent activity</h2>
            <a href="/api/activity?limit=20">API</a>
          </div>
          {activity.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Ledger</th>
                  <th>Type</th>
                  <th>Result</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((event) => (
                  <tr key={event.transaction_hash}>
                    <td>{event.ledger_index.toLocaleString()}</td>
                    <td>{event.transaction_type}</td>
                    <td>{event.result_code}</td>
                    <td>
                      <a href={`/api/transactions/${event.transaction_hash}`}>
                        {event.transaction_hash}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">
              {loading ? 'Loading activity' : 'No indexed protocol activity available'}
            </p>
          )}
        </section>
      </section>

      <footer>
        No wallet connection, signing, lending, repayment, or investment advice.
      </footer>
    </main>
  )
}
