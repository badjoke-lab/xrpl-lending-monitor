import { useMemo } from 'react'

import {
  DefinitionGrid,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Panel,
  ProvenanceBadge,
  StatusBadge,
  UnavailableBlock,
} from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type { ObjectChange, TransactionDetailResponse } from '../types/activity'

interface TransactionDetailPageProps {
  transactionHash: string
  onNavigate: (path: string) => void
}

const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function rippleTimeToIso(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return new Date((value + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return 'Unavailable'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

function valuePreview(value: unknown): string {
  if (value === null || value === undefined) return 'Unavailable'
  const rendered = typeof value === 'string' ? value : JSON.stringify(value)
  return rendered.length > 120 ? `${rendered.slice(0, 117)}…` : rendered
}

function relationshipLinks(change: ObjectChange, onNavigate: (path: string) => void) {
  const links: Array<{ label: string; id: string; path?: string }> = []
  if (change.relationships.vault_id) {
    links.push({ label: 'Vault', id: change.relationships.vault_id, path: `/vaults/${change.relationships.vault_id}` })
  }
  if (change.relationships.loan_broker_id) {
    links.push({ label: 'Loan Broker', id: change.relationships.loan_broker_id, path: `/loan-brokers/${change.relationships.loan_broker_id}` })
  }
  if (change.relationships.loan_id) {
    links.push({ label: 'Loan', id: change.relationships.loan_id, path: `/loans/${change.relationships.loan_id}` })
  }
  return links.map((link) => link.path ? (
    <a
      key={`${link.label}:${link.id}`}
      className="relationship-chip mono"
      href={link.path}
      title={link.id}
      onClick={(event) => {
        event.preventDefault()
        onNavigate(link.path ?? '/')
      }}
    >{link.label}: {truncateMiddle(link.id, 6)}</a>
  ) : null)
}

export function TransactionDetailPage({ transactionHash, onNavigate }: TransactionDetailPageProps) {
  const normalizedHash = transactionHash.toUpperCase()
  const validHash = /^[A-F0-9]{64}$/.test(normalizedHash)
  const { resource, reload } = useApiResource<TransactionDetailResponse>(
    validHash ? `/api/transactions/${normalizedHash}` : null,
  )
  const response = resource.state === 'ready' ? resource.data : null
  const event = response?.event ?? null
  const source = record(event?.source_json)

  const nodeGroups = useMemo(() => {
    const groups = new Map<string, ObjectChange[]>()
    for (const change of response?.object_changes ?? []) {
      const key = `${change.node_index}:${change.object_type}:${change.object_id}`
      groups.set(key, [...(groups.get(key) ?? []), change])
    }
    return [...groups.values()]
  }, [response])

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <a
          href="/activity"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/activity')
          }}
        >Activity</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="mono">{truncateMiddle(normalizedHash, 10)}</span>
      </nav>

      <header className="page-header transaction-detail-header">
        <div>
          <p className="page-kicker">Transaction detail</p>
          <h1 className="mono">{truncateMiddle(normalizedHash, 12)}</h1>
          <p className="page-summary">
            Indexed transaction evidence, affected Lending objects, normalized field changes, and retained source payloads.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload} disabled={!validHash}>Refresh</button>
          {validHash ? <a className="primary-button" href={`/api/transactions/${normalizedHash}`}>Transaction JSON</a> : null}
        </div>
      </header>

      {!validHash ? (
        <UnavailableBlock
          title="Invalid transaction hash"
          reason="A transaction route requires a 64-character hexadecimal XRPL transaction hash."
        />
      ) : null}
      {validHash && resource.state === 'loading' ? <LoadingBlock label="Loading transaction detail" /> : null}
      {validHash && resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}

      {response ? (
        <>
          <section className="transaction-summary-grid" aria-label="Transaction summary">
            <article className="status-summary-card">
              <span>Transaction type</span>
              <strong>{event?.transaction_type ?? 'Unavailable'}</strong>
              <ProvenanceBadge value={event?.provenance ?? 'unavailable'} />
            </article>
            <article className="status-summary-card">
              <span>Result</span>
              <strong>{event ? <StatusBadge value={event.result_code} /> : 'Unavailable'}</strong>
              <small>Indexed validated result</small>
            </article>
            <article className="status-summary-card">
              <span>Affected nodes</span>
              <strong>{formatInteger(nodeGroups.length)}</strong>
              <small>{formatInteger(response.object_changes.length)} normalized field change(s)</small>
            </article>
            <article className="status-summary-card">
              <span>Payload</span>
              <strong>{event?.payload_retained ? 'Retained' : 'Unavailable'}</strong>
              <small>Raw source and metadata retention</small>
            </article>
          </section>

          <Panel title="Transaction evidence" description="Indexed event identity and retained source fields">
            <DefinitionGrid
              items={[
                { label: 'Transaction hash', value: normalizedHash, mono: true, wide: true },
                { label: 'Epoch', value: event?.epoch_id ?? response.object_changes[0]?.epoch_id ?? 'Unavailable', mono: true },
                { label: 'Ledger', value: formatInteger(event?.ledger_index ?? response.object_changes[0]?.ledger_index), mono: true },
                { label: 'Event index', value: formatInteger(event?.event_index) },
                { label: 'Close time', value: formatUtc(rippleTimeToIso(event?.close_time ?? response.object_changes[0]?.close_time)) },
                { label: 'Initiating account', value: scalar(source?.Account), mono: true, wide: true },
                { label: 'Fee', value: scalar(source?.Fee), mono: true },
                { label: 'Sequence', value: scalar(source?.Sequence), mono: true },
                { label: 'Indexed at', value: formatUtc(event?.created_at ?? response.object_changes[0]?.created_at) },
                { label: 'Provenance', value: <ProvenanceBadge value="indexed" /> },
              ]}
            />
          </Panel>

          <Panel title="Affected nodes" description="Field changes grouped by affected ledger object">
            {nodeGroups.length === 0 ? (
              <EmptyBlock message="No normalized Lending object changes were recorded for this transaction." />
            ) : (
              <div className="affected-node-list">
                {nodeGroups.map((changes) => {
                  const first = changes[0]
                  if (!first) return null
                  return (
                    <article className="affected-node-card" key={`${first.node_index}:${first.object_type}:${first.object_id}`}>
                      <header>
                        <div>
                          <span className="node-index">Node {formatInteger(first.node_index)}</span>
                          <h3>{first.object_type}</h3>
                          <p className="mono" title={first.object_id}>{truncateMiddle(first.object_id, 12)}</p>
                        </div>
                        <StatusBadge value={first.action} />
                      </header>
                      <div className="relationship-chip-list">
                        {relationshipLinks(first, onNavigate)}
                        {first.relationships.account ? <span className="relationship-chip mono">Account: {truncateMiddle(first.relationships.account, 6)}</span> : null}
                        {first.relationships.owner ? <span className="relationship-chip mono">Owner: {truncateMiddle(first.relationships.owner, 6)}</span> : null}
                        {first.relationships.borrower ? <span className="relationship-chip mono">Borrower: {truncateMiddle(first.relationships.borrower, 6)}</span> : null}
                        {first.relationships.asset_key ? <span className="relationship-chip">Asset: {first.relationships.asset_key}</span> : null}
                      </div>
                      <div className="table-scroll" tabIndex={0} aria-label={`${first.object_type} normalized changes`}>
                        <table className="data-table transaction-change-table">
                          <thead>
                            <tr>
                              <th scope="col">Field</th>
                              <th scope="col">Before</th>
                              <th scope="col">After</th>
                              <th scope="col">Value type</th>
                              <th scope="col">Support</th>
                            </tr>
                          </thead>
                          <tbody>
                            {changes.map((change) => (
                              <tr key={`${change.node_index}:${change.field_name}`}>
                                <td className="mono">{change.field_name}</td>
                                <td className="mono change-value" title={scalar(change.before_json)}>{valuePreview(change.before_json)}</td>
                                <td className="mono change-value" title={scalar(change.after_json)}>{valuePreview(change.after_json)}</td>
                                <td>{change.value_type}</td>
                                <td>{change.unsupported_field ? <StatusBadge value="unsupported" /> : <StatusBadge value="normalized" />}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel title="Retained source payloads" description="Raw transaction and metadata are shown only when retained" className="raw-data-panel">
            {event?.payload_retained && (event.source_json || event.metadata_json) ? (
              <div className="transaction-raw-grid">
                <section>
                  <h3>Transaction</h3>
                  <pre>{JSON.stringify(event.source_json, null, 2)}</pre>
                </section>
                <section>
                  <h3>Metadata</h3>
                  <pre>{JSON.stringify(event.metadata_json, null, 2)}</pre>
                </section>
              </div>
            ) : (
              <UnavailableBlock
                title="Raw payload unavailable"
                reason="The indexed event or normalized changes remain visible, but raw transaction payloads were not retained for this record."
              />
            )}
          </Panel>
        </>
      ) : null}
    </div>
  )
}
