import {
  DefinitionGrid,
  ErrorBlock,
  LoadingBlock,
  Panel,
  ProvenanceBadge,
  UnavailableBlock,
} from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, truncateMiddle } from '../lib/formatting'
import type { LoanBrokerDetailResponse, LoanBrokerRecord } from '../types/api'

interface LoanBrokerDetailPageProps {
  brokerId: string
  onNavigate: (path: string) => void
}

function amount(value: string | null, assetKey: string): string {
  return value === null ? 'Unavailable' : `${value} ${assetKey}`
}

function percentageFromBps(value: number | null): string {
  return value === null ? 'Unavailable' : `${(value / 100).toFixed(2)}%`
}

function coverPosition(broker: LoanBrokerRecord) {
  const value = broker.derived.cover_surplus
  if (value === null) return { label: 'Unavailable', amount: 'Unavailable', shortfall: false }
  return value.startsWith('-')
    ? { label: 'Cover shortfall', amount: `${value.slice(1)} ${broker.asset.key}`, shortfall: true }
    : { label: 'Cover surplus', amount: `${value} ${broker.asset.key}`, shortfall: false }
}

export function LoanBrokerDetailPage({ brokerId, onNavigate }: LoanBrokerDetailPageProps) {
  const { resource, reload } = useApiResource<LoanBrokerDetailResponse>(`/api/loan-brokers/${brokerId}`)
  const response = resource.state === 'ready' ? resource.data : null
  const broker = response?.data ?? null
  const position = broker ? coverPosition(broker) : null

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <a
          href="/loan-brokers"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/loan-brokers')
          }}
        >Loan Brokers</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="mono">{truncateMiddle(brokerId, 10)}</span>
      </nav>

      <header className="page-header broker-detail-header">
        <div>
          <p className="page-kicker">Loan Broker detail</p>
          <h1 className="mono">{truncateMiddle(brokerId, 12)}</h1>
          <p className="page-summary">
            Current Broker debt and first-loss cover from the active Devnet snapshot, using the related Vault asset.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={`/api/loan-brokers/${brokerId}`}>Broker JSON</a>
        </div>
      </header>

      {resource.state === 'loading' ? <LoadingBlock label="Loading Loan Broker detail" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}
      {response?.availability.state === 'unavailable' ? (
        <UnavailableBlock
          title="Loan Broker detail unavailable"
          reason={response.availability.reason ?? 'Current Loan Broker data is unavailable.'}
        />
      ) : null}

      {broker && position ? (
        <>
          <section className="broker-summary-grid" aria-label="Loan Broker summary">
            <article className="status-summary-card">
              <span>Asset</span>
              <strong>{broker.asset.key}</strong>
              <small>Inherited from verified Vault</small>
            </article>
            <article className="status-summary-card">
              <span>Debt utilization</span>
              <strong>{percentageFromBps(broker.derived.debt_utilization_bps)}</strong>
              <small>{broker.derived.provenance}</small>
            </article>
            <article className="status-summary-card">
              <span>Cover available</span>
              <strong className="mono">{broker.cover_available}</strong>
              <small>{broker.asset.key}</small>
            </article>
            <article className={`status-summary-card ${position.shortfall ? 'summary-shortfall' : ''}`}>
              <span>{position.label}</span>
              <strong className="mono">{position.amount}</strong>
              <small>Required minimum cover comparison</small>
            </article>
          </section>

          <div className="overview-grid">
            <Panel
              title="Current Broker state"
              description="Direct fields from the verified active snapshot"
              action={<ProvenanceBadge value={broker.provenance.object} />}
            >
              <DefinitionGrid
                items={[
                  { label: 'Broker ID', value: broker.id, wide: true, mono: true },
                  { label: 'Owner', value: broker.owner, wide: true, mono: true },
                  { label: 'Pseudo-account', value: broker.account, wide: true, mono: true },
                  { label: 'Sequence', value: formatInteger(broker.sequence) },
                  { label: 'Loan sequence', value: formatInteger(broker.loan_sequence) },
                  { label: 'Owner count', value: formatInteger(broker.owner_count) },
                  { label: 'Management fee rate', value: broker.management_fee_rate === null ? 'Unavailable' : formatInteger(broker.management_fee_rate) },
                  { label: 'Flags', value: formatInteger(broker.flags), mono: true },
                  { label: 'Previous ledger', value: formatInteger(broker.previous_ledger_index), mono: true },
                  { label: 'Previous transaction', value: broker.previous_transaction_hash, wide: true, mono: true },
                ]}
              />
            </Panel>

            <Panel title="Debt and first-loss cover" description="Exact values remain within the related Vault asset">
              <DefinitionGrid
                items={[
                  { label: 'Asset', value: broker.asset.key, wide: true },
                  { label: 'Debt total', value: amount(broker.debt_total, broker.asset.key), wide: true, mono: true },
                  { label: 'Debt maximum', value: amount(broker.debt_maximum, broker.asset.key), wide: true, mono: true },
                  { label: 'Debt utilization', value: percentageFromBps(broker.derived.debt_utilization_bps) },
                  { label: 'Cover available', value: amount(broker.cover_available, broker.asset.key), wide: true, mono: true },
                  { label: 'Minimum cover rate', value: `${(broker.cover_rate_minimum / 1000).toFixed(3)}%` },
                  { label: 'Liquidation cover rate', value: `${(broker.cover_rate_liquidation / 1000).toFixed(3)}%` },
                  { label: 'Required minimum cover', value: amount(broker.derived.required_minimum_cover, broker.asset.key), wide: true, mono: true },
                  { label: position.label, value: position.amount, wide: true, mono: true },
                  { label: 'Cover ratio', value: percentageFromBps(broker.derived.cover_ratio_bps) },
                  { label: 'Derived provenance', value: <ProvenanceBadge value={broker.derived.provenance} /> },
                  { label: 'Debt formula', value: broker.derived.formulas.debt_utilization, wide: true },
                  { label: 'Required cover formula', value: broker.derived.formulas.required_cover, wide: true },
                  { label: 'Cover position formula', value: broker.derived.formulas.cover_surplus, wide: true },
                ]}
              />
            </Panel>
          </div>

          <Panel title="Related Vault" description="Direct relationship resolved within the active snapshot">
            <div className="related-entity-card">
              <div>
                <span>Vault</span>
                <strong className="mono">{truncateMiddle(broker.related_vault.id, 12)}</strong>
                <small>{broker.related_vault.asset.key} · owner {truncateMiddle(broker.related_vault.owner, 8)}</small>
              </div>
              <a
                className="secondary-button"
                href={`/vaults/${broker.related_vault.id}`}
                onClick={(event) => {
                  event.preventDefault()
                  onNavigate(`/vaults/${broker.related_vault.id}`)
                }}
              >Open Vault</a>
            </div>
          </Panel>

          <Panel title="Loan book and history" description="Dedicated current Loan and indexed history APIs are separate roadmap units">
            <UnavailableBlock
              title="Loan book and Broker history not yet available"
              reason="This page does not infer Loan counts, impairment states, activity, or historical series before their verified APIs are connected."
            />
          </Panel>

          <Panel title="Raw decoded Broker object" description="Technical data follows the human-readable summary">
            <pre className="raw-data-panel"><code>{JSON.stringify(broker.raw ?? {}, null, 2)}</code></pre>
          </Panel>
        </>
      ) : null}
    </div>
  )
}
