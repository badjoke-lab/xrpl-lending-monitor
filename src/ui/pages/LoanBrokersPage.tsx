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
import type { LoanBrokerCollectionResponse, LoanBrokerRecord } from '../types/api'

interface LoanBrokersPageProps {
  onNavigate: (path: string) => void
}

interface BrokerFilters {
  query: string
  sort: 'id_asc' | 'id_desc'
}

function amount(value: string | null, assetKey: string): string {
  return value === null ? 'Unavailable' : `${value} ${assetKey}`
}

function basisPoints(value: number | null): string {
  return value === null ? 'Unavailable' : `${(value / 100).toFixed(2)}%`
}

function coverBalance(broker: LoanBrokerRecord): { label: string; value: string } {
  const value = broker.derived.cover_surplus
  if (value === null) return { label: 'Unavailable', value: 'Unavailable' }
  return value.startsWith('-')
    ? { label: 'Shortfall', value: `${value.slice(1)} ${broker.asset.key}` }
    : { label: 'Surplus', value: `${value} ${broker.asset.key}` }
}

export function LoanBrokersPage({ onNavigate }: LoanBrokersPageProps) {
  const [draftQuery, setDraftQuery] = useState('')
  const [draftSort, setDraftSort] = useState<'id_asc' | 'id_desc'>('id_asc')
  const [filters, setFilters] = useState<BrokerFilters>({ query: '', sort: 'id_asc' })
  const [cursor, setCursor] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<string | null>>([])

  const url = useMemo(() => {
    const params = new URLSearchParams({ limit: '25', sort: filters.sort })
    if (filters.query) params.set('q', filters.query)
    if (cursor) params.set('cursor', cursor)
    return `/api/loan-brokers?${params.toString()}`
  }, [cursor, filters])

  const { resource, reload } = useApiResource<LoanBrokerCollectionResponse>(url)
  const response = resource.state === 'ready' ? resource.data : null

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-kicker">Monitor</p>
          <h1>Loan Brokers</h1>
          <p className="page-summary">
            Current Broker debt and first-loss cover, paired with the canonical asset of each related Vault.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="primary-button" href={url}>Broker JSON</a>
        </div>
      </header>

      <Panel title="Find Loan Brokers" description="Search factual Broker and related Vault identity fields">
        <form
          className="broker-filter-form"
          onSubmit={(event) => {
            event.preventDefault()
            setFilters({ query: draftQuery.trim(), sort: draftSort })
            setCursor(null)
            setHistory([])
          }}
        >
          <label>
            <span>Search</span>
            <input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="Broker ID, Vault ID, owner, account"
              maxLength={128}
            />
          </label>
          <label>
            <span>Order</span>
            <select value={draftSort} onChange={(event) => setDraftSort(event.target.value as 'id_asc' | 'id_desc')}>
              <option value="id_asc">Broker ID ascending</option>
              <option value="id_desc">Broker ID descending</option>
            </select>
          </label>
          <button className="primary-button" type="submit">Apply</button>
        </form>
      </Panel>

      {resource.state === 'loading' ? <LoadingBlock label="Loading current Loan Brokers" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}
      {response?.availability.state === 'unavailable' ? (
        <UnavailableBlock
          title="Loan Broker collection unavailable"
          reason={response.availability.reason ?? 'Current Loan Broker data is unavailable.'}
        />
      ) : null}

      {response?.availability.state === 'available' ? (
        <Panel
          title="Current Loan Brokers"
          description={`Snapshot ${response.snapshot?.id ?? 'Unavailable'} · ledger ${formatInteger(response.snapshot?.ledger_index)}`}
          action={<ProvenanceBadge value={response.provenance.collection} />}
        >
          {response.data.length === 0 ? (
            <EmptyBlock message={response.page.next_cursor ? 'No Brokers matched in this bounded shard window. Continue to the next window.' : 'No Brokers matched the current query.'} />
          ) : (
            <div className="table-scroll" tabIndex={0} aria-label="Current Loan Brokers table">
              <table className="data-table broker-table">
                <thead>
                  <tr>
                    <th scope="col">Broker</th>
                    <th scope="col">Asset</th>
                    <th scope="col">Debt</th>
                    <th scope="col">Maximum</th>
                    <th scope="col">Utilization</th>
                    <th scope="col">Cover</th>
                    <th scope="col">Required</th>
                    <th scope="col">Surplus / shortfall</th>
                    <th scope="col">Vault</th>
                  </tr>
                </thead>
                <tbody>
                  {response.data.map((broker) => {
                    const balance = coverBalance(broker)
                    return (
                      <tr key={broker.id}>
                        <td>
                          <a
                            className="identifier-link mono"
                            href={`/loan-brokers/${broker.id}`}
                            title={broker.id}
                            onClick={(event) => {
                              event.preventDefault()
                              onNavigate(`/loan-brokers/${broker.id}`)
                            }}
                          >
                            {truncateMiddle(broker.id)}
                          </a>
                          <small className="table-secondary mono">{truncateMiddle(broker.owner, 6)}</small>
                        </td>
                        <td><span className="asset-chip">{broker.asset.key}</span></td>
                        <td className="mono">{amount(broker.debt_total, broker.asset.key)}</td>
                        <td className="mono">{amount(broker.debt_maximum, broker.asset.key)}</td>
                        <td>{basisPoints(broker.derived.debt_utilization_bps)}</td>
                        <td className="mono">{amount(broker.cover_available, broker.asset.key)}</td>
                        <td className="mono">{amount(broker.derived.required_minimum_cover, broker.asset.key)}</td>
                        <td>
                          <span className={`cover-balance ${balance.label === 'Shortfall' ? 'is-shortfall' : 'is-surplus'}`}>
                            <strong>{balance.label}</strong>
                            <small className="mono">{balance.value}</small>
                          </span>
                        </td>
                        <td>
                          <a
                            className="identifier-link mono"
                            href={`/vaults/${broker.related_vault.id}`}
                            title={broker.related_vault.id}
                            onClick={(event) => {
                              event.preventDefault()
                              onNavigate(`/vaults/${broker.related_vault.id}`)
                            }}
                          >
                            {truncateMiddle(broker.related_vault.id)}
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination-bar">
            <span>
              Read {formatInteger(response.page.broker_shards_read)} Broker shard(s) + {formatInteger(response.page.relation_shards_read)} relationship shard(s) · examined {formatInteger(response.page.objects_examined)} Broker object(s)
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
              >Previous</button>
              <button
                className="secondary-button"
                type="button"
                disabled={!response.page.next_cursor}
                onClick={() => {
                  setHistory((items) => [...items, cursor])
                  setCursor(response.page.next_cursor)
                }}
              >Next</button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
