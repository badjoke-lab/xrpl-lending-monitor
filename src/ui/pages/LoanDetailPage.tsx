import {
  DefinitionGrid,
  ErrorBlock,
  LoadingBlock,
  Panel,
  ProvenanceBadge,
  StatusBadge,
  UnavailableBlock,
} from '../components/DataDisplay'
import { useApiResource } from '../hooks/useApiResource'
import { formatInteger, formatUtc, truncateMiddle } from '../lib/formatting'
import type {
  LoanDetailResponse,
  LoanLifecycleResponse,
  LoanRecord,
  ObjectHistoryResponse,
} from '../types/api'

interface LoanDetailPageProps {
  loanId: string
  onNavigate: (path: string) => void
}

function amount(value: string, loan: LoanRecord): string {
  return `${value} ${loan.asset.key}`
}

function rate(value: number): string {
  return value.toLocaleString('en-US')
}

export function LoanDetailPage({ loanId, onNavigate }: LoanDetailPageProps) {
  const { resource, reload } = useApiResource<LoanDetailResponse>(`/api/loans/${loanId}`)
  const lifecycle = useApiResource<LoanLifecycleResponse>(`/api/loans/${loanId}/lifecycle?limit=25`)
  const history = useApiResource<ObjectHistoryResponse>(`/api/objects/Loan/${loanId}/history?limit=25`)
  const response = resource.state === 'ready' ? resource.data : null
  const loan = response?.data ?? null

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <a
          href="/loans"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/loans')
          }}
        >Loans</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="mono">{truncateMiddle(loanId, 10)}</span>
      </nav>

      <header className="page-header loan-detail-header">
        <div>
          <p className="page-kicker">Loan detail</p>
          <h1 className="mono">{truncateMiddle(loanId, 12)}</h1>
          <p className="page-summary">
            Current Loan terms, exact balances, and payment schedule from the verified active Devnet snapshot.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={reload}>Refresh</button>
          <a className="secondary-button developer-action" href={`/api/loans/${loanId}`}>Loan JSON</a>
        </div>
      </header>

      {resource.state === 'loading' ? <LoadingBlock label="Loading Loan detail" /> : null}
      {resource.state === 'error' ? <ErrorBlock message={resource.error} onRetry={reload} /> : null}
      {response?.availability.state === 'unavailable' ? (
        <UnavailableBlock
          title="Loan detail unavailable"
          reason={response.availability.reason ?? 'Current Loan data is unavailable.'}
        />
      ) : null}

      {loan ? (
        <>
          <div className="loan-state-note" role="note">
            <strong>State interpretation</strong>
            <span>Schedule-derived eligibility is a calculation. It does not mean the on-ledger Loan is defaulted.</span>
          </div>

          <section className="loan-summary-grid" aria-label="Loan summary">
            <article className="status-summary-card">
              <span>Asset</span>
              <strong>{loan.asset.key}</strong>
              <small>Resolved from verified Vault</small>
            </article>
            <article className="status-summary-card">
              <span>On-ledger state</span>
              <strong><StatusBadge value={loan.on_ledger_status} /></strong>
              <small>Direct · flags {loan.flags}</small>
            </article>
            <article className="status-summary-card schedule-derived-card">
              <span>Schedule-derived state</span>
              <strong><StatusBadge value={loan.schedule_status} /></strong>
              <small>Derived calculation at {formatUtc(loan.status_source.evaluated_at)}</small>
            </article>
            <article className="status-summary-card">
              <span>Total outstanding</span>
              <strong className="mono">{loan.total_value_outstanding}</strong>
              <small>{loan.asset.key}</small>
            </article>
          </section>

          <div className="overview-grid">
            <Panel
              title="Current Loan state"
              description="Direct fields from the verified active snapshot"
              action={<ProvenanceBadge value={loan.provenance.object} />}
            >
              <DefinitionGrid
                items={[
                  { label: 'Loan ID', value: loan.id, wide: true, mono: true },
                  { label: 'Borrower', value: loan.borrower, wide: true, mono: true },
                  { label: 'Loan sequence', value: formatInteger(loan.loan_sequence) },
                  { label: 'On-ledger state', value: <StatusBadge value={loan.on_ledger_status} /> },
                  { label: 'Schedule-derived state', value: <StatusBadge value={loan.schedule_status} /> },
                  { label: 'Supports overpayment', value: loan.supports_overpayment ? 'Yes' : 'No' },
                  { label: 'Flags', value: formatInteger(loan.flags), mono: true },
                  { label: 'Previous ledger', value: formatInteger(loan.previous_ledger_index), mono: true },
                  { label: 'Previous transaction', value: loan.previous_transaction_hash, wide: true, mono: true },
                ]}
              />
            </Panel>

            <Panel title="Current balances" description="Exact values remain within the related Vault asset">
              <DefinitionGrid
                items={[
                  { label: 'Asset', value: loan.asset.key, wide: true },
                  { label: 'Principal outstanding', value: amount(loan.principal_outstanding, loan), wide: true, mono: true },
                  { label: 'Total value outstanding', value: amount(loan.total_value_outstanding, loan), wide: true, mono: true },
                  { label: 'Management fee outstanding', value: amount(loan.management_fee_outstanding, loan), wide: true, mono: true },
                  { label: 'Periodic payment', value: amount(loan.periodic_payment, loan), wide: true, mono: true },
                  { label: 'Payments remaining', value: formatInteger(loan.payment_remaining) },
                  { label: 'Loan scale', value: formatInteger(loan.loan_scale) },
                  { label: 'Asset provenance', value: <ProvenanceBadge value={loan.provenance.asset} /> },
                ]}
              />
            </Panel>
          </div>

          <Panel title="Payment schedule" description="Schedule state is derived independently from protocol state">
            <DefinitionGrid
              items={[
                { label: 'Start date', value: formatUtc(loan.start_date), wide: true },
                { label: 'Payment interval', value: `${formatInteger(loan.payment_interval_seconds)} seconds` },
                { label: 'Grace period', value: `${formatInteger(loan.grace_period_seconds)} seconds` },
                { label: 'Previous payment due', value: formatUtc(loan.previous_payment_due), wide: true },
                { label: 'Next payment due', value: formatUtc(loan.next_payment_due), wide: true },
                { label: 'Schedule-derived eligibility at', value: formatUtc(loan.default_eligible_at), wide: true },
                { label: 'Evaluated at', value: formatUtc(loan.status_source.evaluated_at), wide: true },
                { label: 'Schedule provenance', value: <ProvenanceBadge value={loan.provenance.schedule_status} /> },
                { label: 'Raw next due', value: formatInteger(loan.next_payment_due_ripple_time), mono: true },
                { label: 'Raw schedule eligibility', value: formatInteger(loan.default_eligible_ripple_time), mono: true },
              ]}
            />
          </Panel>

          <Panel title="Loan terms" description="Direct rates and fees are shown without conversion or interpretation">
            <DefinitionGrid
              items={[
                { label: 'Origination fee', value: amount(loan.loan_origination_fee, loan), wide: true, mono: true },
                { label: 'Service fee', value: amount(loan.loan_service_fee, loan), wide: true, mono: true },
                { label: 'Late payment fee', value: amount(loan.late_payment_fee, loan), wide: true, mono: true },
                { label: 'Close payment fee', value: amount(loan.close_payment_fee, loan), wide: true, mono: true },
                { label: 'Interest rate units', value: rate(loan.interest_rate), mono: true },
                { label: 'Late interest rate units', value: rate(loan.late_interest_rate), mono: true },
                { label: 'Close interest rate units', value: rate(loan.close_interest_rate), mono: true },
                { label: 'Overpayment interest rate units', value: rate(loan.overpayment_interest_rate), mono: true },
                { label: 'Overpayment fee rate units', value: rate(loan.overpayment_fee_rate), mono: true },
              ]}
            />
          </Panel>

          <div className="loan-relationships-grid">
            <Panel title="Related Loan Broker" description="Direct relationship from the active snapshot">
              <div className="related-entity-card">
                <div>
                  <span>Loan Broker</span>
                  <strong className="mono">{truncateMiddle(loan.related_loan_broker.id, 12)}</strong>
                  <small>Owner {truncateMiddle(loan.related_loan_broker.owner, 8)}</small>
                </div>
                <a
                  className="secondary-button"
                  href={`/loan-brokers/${loan.related_loan_broker.id}`}
                  onClick={(event) => {
                    event.preventDefault()
                    onNavigate(`/loan-brokers/${loan.related_loan_broker.id}`)
                  }}
                >Open Broker</a>
              </div>
            </Panel>

            <Panel title="Related Vault" description="Asset authority for this Loan">
              <div className="related-entity-card">
                <div>
                  <span>Vault</span>
                  <strong className="mono">{truncateMiddle(loan.related_vault.id, 12)}</strong>
                  <small>{loan.related_vault.asset.key} · owner {truncateMiddle(loan.related_vault.owner, 8)}</small>
                </div>
                <a
                  className="secondary-button"
                  href={`/vaults/${loan.related_vault.id}`}
                  onClick={(event) => {
                    event.preventDefault()
                    onNavigate(`/vaults/${loan.related_vault.id}`)
                  }}
                >Open Vault</a>
              </div>
            </Panel>
          </div>

          <Panel title="Payment history and lifecycle" description="Current schedule facts are available; indexed history is a later audit unit">
            {lifecycle.resource.state === 'loading' ? <LoadingBlock label="Loading indexed Loan lifecycle" /> : null}
            {lifecycle.resource.state === 'error' ? <ErrorBlock message={lifecycle.resource.error} onRetry={lifecycle.reload} /> : null}
            {lifecycle.resource.state === 'ready' && lifecycle.resource.data.data.length === 0 ? (
              <UnavailableBlock
                title="No indexed lifecycle events available"
                reason="No collected lifecycle events are available for this Loan in the bounded indexed history. Missing history is not inferred."
              />
            ) : null}
            {lifecycle.resource.state === 'ready' && lifecycle.resource.data.data.length > 0 ? (
              <div className="lifecycle-timeline" aria-label="Loan lifecycle timeline">
                {lifecycle.resource.data.data.map((event) => (
                  <article className="lifecycle-event-card" key={`${event.transaction_hash}:${event.event_type}`}>
                    <header>
                      <div>
                        <span className="node-index">Ledger {formatInteger(event.ledger_index)} · #{formatInteger(event.transaction_index)}</span>
                        <h3><StatusBadge value={event.event_type} /> <span>{event.transaction_type}</span></h3>
                        <p>{formatUtc(new Date((event.close_time + 946_684_800) * 1000).toISOString())} UTC · {event.result_code}</p>
                      </div>
                      <ProvenanceBadge value={event.provenance} />
                    </header>
                    <DefinitionGrid
                      items={[
                        { label: 'Status before', value: <StatusBadge value={event.status_before} /> },
                        { label: 'Status after', value: <StatusBadge value={event.status_after} /> },
                        { label: 'Principal before', value: event.principal_before ?? 'Unavailable', mono: true },
                        { label: 'Principal after', value: event.principal_after ?? 'Unavailable', mono: true },
                        { label: 'Payments before', value: formatInteger(event.payment_remaining_before) },
                        { label: 'Payments after', value: formatInteger(event.payment_remaining_after) },
                        { label: 'Transaction', value: (
                          <a
                            href={`/transactions/${event.transaction_hash}`}
                            onClick={(click) => {
                              click.preventDefault()
                              onNavigate(`/transactions/${event.transaction_hash}`)
                            }}
                          >{truncateMiddle(event.transaction_hash, 12)}</a>
                        ), wide: true, mono: true },
                      ]}
                    />
                  </article>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel title="State changes" description="Normalized before-and-after Loan field changes from indexed AffectedNodes">
            {history.resource.state === 'loading' ? <LoadingBlock label="Loading normalized Loan changes" /> : null}
            {history.resource.state === 'error' ? <ErrorBlock message={history.resource.error} onRetry={history.reload} /> : null}
            {history.resource.state === 'ready' && history.resource.data.data.length === 0 ? (
              <UnavailableBlock
                title="No indexed state changes available"
                reason="No normalized before-and-after field changes are available for this Loan in the bounded indexed history."
              />
            ) : null}
            {history.resource.state === 'ready' && history.resource.data.data.length > 0 ? (
              <div className="state-change-list" aria-label="Loan state changes">
                {history.resource.data.data.map((change) => (
                  <article className="state-change-card" key={`${change.transaction_hash}:${change.node_index}:${change.field_name}:${change.action}`}>
                    <header>
                      <div>
                        <span className="node-index">Ledger {formatInteger(change.ledger_index)} · node {formatInteger(change.node_index)}</span>
                        <h3>{change.field_name}</h3>
                        <p>{change.transaction_type} · {change.action} · {change.result_code}</p>
                      </div>
                      <ProvenanceBadge value={change.provenance} />
                    </header>
                    <div className="state-change-values">
                      <div><span>Before</span><code>{JSON.stringify(change.before_json)}</code></div>
                      <div><span>After</span><code>{JSON.stringify(change.after_json)}</code></div>
                    </div>
                    <a
                      href={`/transactions/${change.transaction_hash}`}
                      onClick={(click) => {
                        click.preventDefault()
                        onNavigate(`/transactions/${change.transaction_hash}`)
                      }}
                    >Source transaction {truncateMiddle(change.transaction_hash, 12)}</a>
                  </article>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel title="Raw decoded Loan object" description="Technical data follows the human-readable summary">
            <pre className="raw-data-panel"><code>{JSON.stringify(loan.raw ?? {}, null, 2)}</code></pre>
          </Panel>
        </>
      ) : null}
    </div>
  )
}
