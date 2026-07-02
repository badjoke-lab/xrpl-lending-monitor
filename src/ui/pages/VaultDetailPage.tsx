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
import type { VaultDetailResponse } from '../types/api'

interface VaultDetailPageProps {
  vaultId: string
  onNavigate: (path: string) => void
}

function amount(value: string | null, assetKey: string): string {
  return value === null ? 'Unavailable' : `${value} ${assetKey}`
}

export function VaultDetailPage({ vaultId, onNavigate }: VaultDetailPageProps) {
  const { resource, reload } = useApiResource<VaultDetailResponse>(`/api/vaults/${vaultId}`)
  const response = resource.state === 'ready' ? resource.data : null
  const vault = response?.data ?? null

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <a
          href="/vaults"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/vaults')
          }}
        >
          Vaults
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="mono">{truncateMiddle(vaultId, 10)}</span>
      </nav>

      <header className="page-header vault-detail-header">
        <div>
          <p className="page-kicker">Vault detail</p>
          <h1 className="mono">{truncateMiddle(vaultId, 12)}</h1>
          <p className="page-summary">
            Current validated Vault state from the active Devnet snapshot. Historical records are kept separate.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={`/api/vaults/${vaultId}`}>Vault JSON</a>
        </div>
      </header>

      {resource.state === 'loading' ? <LoadingBlock label="Loading Vault detail" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}
      {response?.availability.state === 'unavailable' ? (
        <UnavailableBlock title="Vault detail unavailable" reason={response.availability.reason ?? 'Current Vault data is unavailable.'} />
      ) : null}

      {vault ? (
        <>
          <section className="vault-summary-grid" aria-label="Vault summary">
            <article className="status-summary-card">
              <span>Asset</span>
              <strong>{vault.asset.key}</strong>
              <small>Canonical asset identity</small>
            </article>
            <article className="status-summary-card">
              <span>Total assets</span>
              <strong className="mono">{vault.assets_total}</strong>
              <small>{vault.asset.key}</small>
            </article>
            <article className="status-summary-card">
              <span>Available</span>
              <strong className="mono">{vault.assets_available}</strong>
              <small>{vault.asset.key}</small>
            </article>
            <article className="status-summary-card">
              <span>Utilization</span>
              <strong>{vault.derived.utilization_bps === null ? 'Unavailable' : `${(vault.derived.utilization_bps / 100).toFixed(2)}%`}</strong>
              <small>{vault.derived.provenance}</small>
            </article>
          </section>

          <div className="overview-grid">
            <Panel title="Current state" description="Direct fields from the verified active snapshot" action={<ProvenanceBadge value={vault.provenance.object} />}>
              <DefinitionGrid
                items={[
                  { label: 'Vault ID', value: vault.id, wide: true, mono: true },
                  { label: 'Owner', value: vault.owner, wide: true, mono: true },
                  { label: 'Pseudo-account', value: vault.account, wide: true, mono: true },
                  { label: 'Share MPT ID', value: vault.share_mpt_id, wide: true, mono: true },
                  { label: 'Domain ID', value: vault.domain_id ?? 'Unavailable', wide: true, mono: true },
                  { label: 'Withdrawal policy', value: formatInteger(vault.withdrawal_policy) },
                  { label: 'Scale', value: formatInteger(vault.scale) },
                  { label: 'Flags', value: formatInteger(vault.flags), mono: true },
                  { label: 'Previous ledger', value: formatInteger(vault.previous_ledger_index), mono: true },
                  { label: 'Previous transaction', value: vault.previous_transaction_hash, wide: true, mono: true },
                ]}
              />
            </Panel>

            <Panel title="Assets and loss" description="Exact quantities remain within one canonical asset">
              <DefinitionGrid
                items={[
                  { label: 'Asset', value: vault.asset.key, wide: true },
                  { label: 'Assets total', value: amount(vault.assets_total, vault.asset.key), wide: true, mono: true },
                  { label: 'Assets available', value: amount(vault.assets_available, vault.asset.key), wide: true, mono: true },
                  { label: 'Assets maximum', value: amount(vault.assets_maximum, vault.asset.key), wide: true, mono: true },
                  { label: 'Used assets', value: amount(vault.derived.used_assets, vault.asset.key), wide: true, mono: true },
                  { label: 'Unrealized loss', value: amount(vault.loss_unrealized, vault.asset.key), wide: true, mono: true },
                  { label: 'Utilization', value: vault.derived.utilization_bps === null ? 'Unavailable' : `${(vault.derived.utilization_bps / 100).toFixed(2)}%` },
                  { label: 'Derived provenance', value: <ProvenanceBadge value={vault.derived.provenance} /> },
                  { label: 'Formula', value: vault.derived.formula, wide: true },
                ]}
              />
            </Panel>
          </div>

          <Panel title="Relationships" description="Connected Brokers, Loans, and history require their dedicated bounded APIs">
            <UnavailableBlock
              title="Relationship panels not yet available"
              reason="The current Vault object is verified. Connected Loan Brokers, Loans, activity, and history remain separate roadmap units and are not inferred here."
            />
          </Panel>

          <Panel title="Raw decoded object" description="Technical data follows the human-readable summary">
            <pre className="raw-data-panel"><code>{JSON.stringify(vault.raw ?? {}, null, 2)}</code></pre>
          </Panel>
        </>
      ) : null}
    </div>
  )
}
