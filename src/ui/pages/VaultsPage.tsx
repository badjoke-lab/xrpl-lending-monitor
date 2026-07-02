import { useMemo, useState } from 'react'

import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Panel,
  ProvenanceBadge,
  UnavailableBlock,
} from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, truncateMiddle } from '../lib/formatting'
import type { VaultCollectionResponse, VaultRecord } from '../types/api'

interface VaultsPageProps {
  onNavigate: (path: string) => void
}

interface VaultFilters {
  query: string
  sort: 'id_asc' | 'id_desc'
  loss: 'all' | 'true' | 'false'
}

function amount(value: string | null, assetKey: string): string {
  return value === null ? 'Unavailable' : `${value} ${assetKey}`
}

function utilization(vault: VaultRecord): string {
  return vault.derived.utilization_bps === null
    ? 'Unavailable'
    : `${(vault.derived.utilization_bps / 100).toFixed(2)}%`
}

export function VaultsPage({ onNavigate }: VaultsPageProps) {
  const [draftQuery, setDraftQuery] = useState('')
  const [draftSort, setDraftSort] = useState<'id_asc' | 'id_desc'>('id_asc')
  const [draftLoss, setDraftLoss] = useState<'all' | 'true' | 'false'>('all')
  const [filters, setFilters] = useState<VaultFilters>({
    query: '',
    sort: 'id_asc',
    loss: 'all',
  })
  const [cursor, setCursor] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<string | null>>([])

  const url = useMemo(() => {
    const params = new URLSearchParams({ limit: '25', sort: filters.sort })
    if (filters.query) params.set('q', filters.query)
    if (filters.loss !== 'all') params.set('has_loss', filters.loss)
    if (cursor) params.set('cursor', cursor)
    return `/api/vaults?${params.toString()}`
  }, [cursor, filters])

  const { resource, reload } = useApiResource<VaultCollectionResponse>(url)
  const response = resource.state === 'ready' ? resource.data : null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Monitor</p>
          <h1>Vaults</h1>
          <p className="page-summary">
            Current validated Vault objects from the active Devnet snapshot. Values remain asset-separated and exact.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={url}>Vault JSON</a>
        </div>
      </header>

      <Panel title="Find Vaults" description="Search factual identity fields and retain bounded snapshot pagination">
        <form
          className="vault-filter-form"
          onSubmit={(event) => {
            event.preventDefault()
            setFilters({ query: draftQuery.trim(), sort: draftSort, loss: draftLoss })
            setCursor(null)
            setHistory([])
          }}
        >
          <label>
            <span>Search</span>
            <input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="Vault ID, owner, account, asset, domain"
              maxLength={128}
            />
          </label>
          <label>
            <span>Loss</span>
            <select value={draftLoss} onChange={(event) => setDraftLoss(event.target.value as 'all' | 'true' | 'false')}>
              <option value="all">All</option>
              <option value="true">Has unrealized loss</option>
              <option value="false">No unrealized loss</option>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select value={draftSort} onChange={(event) => setDraftSort(event.target.value as 'id_asc' | 'id_desc')}>
              <option value="id_asc">Vault ID ascending</option>
              <option value="id_desc">Vault ID descending</option>
            </select>
          </label>
          <button className="primary-button" type="submit">Apply</button>
        </form>
      </Panel>

      {resource.state === 'loading' ? <LoadingBlock label="Loading current Vaults" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}
      {response?.availability.state === 'unavailable' ? (
        <UnavailableBlock title="Vault collection unavailable" reason={response.availability.reason ?? 'Current Vault data is unavailable.'} />
      ) : null}

      {response?.availability.state === 'available' ? (
        <Panel
          title="Current Vaults"
          description={`Snapshot ${response.snapshot?.id ?? 'Unavailable'} · ledger ${formatInteger(response.snapshot?.ledger_index)}`}
          action={<ProvenanceBadge value={response.provenance.collection} />}
        >
          {response.data.length === 0 ? (
            <EmptyBlock message={response.page.next_cursor ? 'No Vaults matched in this bounded shard window. Continue to scan the next window.' : 'No Vaults matched the current filters.'} />
          ) : (
            <div className="table-scroll" tabIndex={0} aria-label="Current Vaults table">
              <table className="data-table vault-table">
                <thead>
                  <tr>
                    <th scope="col">Vault</th>
                    <th scope="col">Asset</th>
                    <th scope="col">Total</th>
                    <th scope="col">Available</th>
                    <th scope="col">Used</th>
                    <th scope="col">Utilization</th>
                    <th scope="col">Loss</th>
                    <th scope="col">Last ledger</th>
                  </tr>
                </thead>
                <tbody>
                  {response.data.map((vault) => (
                    <tr key={vault.id}>
                      <td>
                        <a
                          className="identifier-link mono"
                          href={`/vaults/${vault.id}`}
                          title={vault.id}
                          onClick={(event) => {
                            event.preventDefault()
                            onNavigate(`/vaults/${vault.id}`)
                          }}
                        >
                          {truncateMiddle(vault.id)}
                        </a>
                        <small className="table-secondary mono">{truncateMiddle(vault.owner, 6)}</small>
                      </td>
                      <td><span className="asset-chip">{vault.asset.key}</span></td>
                      <td className="mono">{amount(vault.assets_total, vault.asset.key)}</td>
                      <td className="mono">{amount(vault.assets_available, vault.asset.key)}</td>
                      <td className="mono">{amount(vault.derived.used_assets, vault.asset.key)}</td>
                      <td>{utilization(vault)}</td>
                      <td className="mono">{amount(vault.loss_unrealized, vault.asset.key)}</td>
                      <td className="mono">{formatInteger(vault.previous_ledger_index)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination-bar">
            <span>
              Read {formatInteger(response.page.shards_read)} shard(s) · examined {formatInteger(response.page.objects_examined)} Vault object(s)
            </span>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={history.length === 0}
                onClick={() => {
                  const previous = history.at(-1) ?? null
                  setHistory((items) => items.slice(0, -1))
                  setCursor(previous)
                }}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!response.page.next_cursor}
                onClick={() => {
                  setHistory((items) => [...items, cursor])
                  setCursor(response.page.next_cursor)
                }}
              >
                Next
              </button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
