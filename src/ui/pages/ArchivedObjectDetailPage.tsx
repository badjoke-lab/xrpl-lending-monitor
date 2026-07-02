import { EmptyBlock, ErrorBlock, LoadingBlock, Panel, ProvenanceBadge, StatusBadge } from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { ArchivedObjectDetailResponse, ArchivedObjectRecord } from '../types/api'

interface ArchivedObjectDetailPageProps {
  objectType: string
  objectId: string
  onNavigate: (path: string) => void
}

const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function rippleTimeToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null
  return new Date((value + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function detailUrl(objectType: string, objectId: string): string {
  return `/api/audit/archived/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}`
}

function currentLookupPath(archive: ArchivedObjectRecord): string {
  if (archive.object_type === 'Vault') return `/vaults/${archive.object_id}`
  if (archive.object_type === 'LoanBroker') return `/loan-brokers/${archive.object_id}`
  return `/loans/${archive.object_id}`
}

function relationshipRows(archive: ArchivedObjectRecord) {
  return [
    ['Vault', archive.relationships.vault_id],
    ['Loan Broker', archive.relationships.loan_broker_id],
    ['Loan', archive.relationships.loan_id],
    ['Owner', archive.relationships.owner],
    ['Account', archive.relationships.account],
    ['Borrower', archive.relationships.borrower],
    ['Asset', archive.relationships.asset_key],
  ] as const
}

export function ArchivedObjectDetailPage({ objectType, objectId, onNavigate }: ArchivedObjectDetailPageProps) {
  const { resource, reload } = useApiResource<ArchivedObjectDetailResponse>(detailUrl(objectType, objectId))
  const response = resource.state === 'ready' ? resource.data : null
  const archive = response?.data ?? null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Archived object</p>
          <h1>{objectType} {truncateMiddle(objectId, 12)}</h1>
          <p className="page-summary">
            Final indexed state and deletion evidence for a historical object. This page does not claim the object remains current.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={detailUrl(objectType, objectId)}>Archive JSON</a>
        </div>
      </header>

      <div className="archive-banner" role="note">
        <strong>Archived context</strong>
        <span>Current existence is not implied. Open current lookups only to check a separately verified active snapshot.</span>
      </div>

      {resource.state === 'loading' ? <LoadingBlock label="Loading archived object" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response && !archive ? (
        <EmptyBlock message={response.availability.reason ?? 'Archived object is unavailable.'} />
      ) : null}

      {archive ? (
        <>
          <Panel
            title="Final archived state"
            description="Deleted object retained from indexed ledger metadata"
            action={<ProvenanceBadge value={archive.provenance} />}
          >
            <dl className="transaction-summary-grid">
              <div><dt>Object type</dt><dd><StatusBadge value={archive.object_type} /></dd></div>
              <div><dt>Deletion classification</dt><dd><StatusBadge value={archive.deletion_reason} /></dd></div>
              <div><dt>Epoch</dt><dd className="mono">{archive.epoch_id}</dd></div>
              <div><dt>Archived at</dt><dd>{formatUtc(archive.archived_at)}</dd></div>
            </dl>
          </Panel>

          <Panel title="Deletion event" description="Source transaction and ledger position that removed the object from current projections">
            <dl className="transaction-summary-grid">
              <div>
                <dt>Transaction</dt>
                <dd>
                  <a
                    href={`/transactions/${archive.deletion_transaction_hash}`}
                    onClick={(click) => { click.preventDefault(); onNavigate(`/transactions/${archive.deletion_transaction_hash}`) }}
                  >{truncateMiddle(archive.deletion_transaction_hash, 12)}</a>
                </dd>
              </div>
              <div><dt>Ledger</dt><dd className="mono">{formatInteger(archive.deletion_ledger_index)}</dd></div>
              <div><dt>Transaction index</dt><dd className="mono">{formatInteger(archive.deletion_transaction_index)}</dd></div>
              <div><dt>Close time</dt><dd>{formatUtc(rippleTimeToIso(archive.deletion_close_time))}</dd></div>
            </dl>
          </Panel>

          <Panel
            title="Relationships and cross-links"
            description="Indexed relationships from the final object state; they do not prove related objects are currently active"
            action={(
              <button className="secondary-button" type="button" onClick={() => onNavigate(currentLookupPath(archive))}>
                Current lookup
              </button>
            )}
          >
            <dl className="relationship-detail-grid">
              {relationshipRows(archive).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={value ? 'mono' : undefined}>{value ?? 'Unavailable'}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Archive metadata and provenance" description="How this archived record is retained and scoped">
            <dl className="transaction-summary-grid">
              <div><dt>Network</dt><dd>Devnet</dd></div>
              <div><dt>Epoch</dt><dd className="mono">{archive.epoch_id}</dd></div>
              <div><dt>Collection</dt><dd><ProvenanceBadge value="indexed" /></dd></div>
              <div><dt>Unavailable fields</dt><dd>Left unavailable, not replaced with zero.</dd></div>
            </dl>
          </Panel>

          <Panel title="Raw final state" description="Retained final object fields from the archive record">
            <pre className="raw-data-panel"><code>{JSON.stringify(archive.final_state_json, null, 2)}</code></pre>
          </Panel>
        </>
      ) : null}
    </div>
  )
}
