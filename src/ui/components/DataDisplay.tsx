import type { ReactNode } from 'react'

import { statusTone, titleCase } from '../lib/formatting'
import type { Provenance } from '../types/api'

export function Panel({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function MetricCard({
  label,
  value,
  detail,
  provenance,
}: {
  label: string
  value: string
  detail?: string
  provenance: Provenance
}) {
  const unavailable = provenance === 'unavailable'
  return (
    <article className={`metric-card${unavailable ? ' is-unavailable' : ''}`}>
      <div className="metric-label-row">
        <span>{label}</span>
        <ProvenanceBadge value={provenance} />
      </div>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </article>
  )
}

export function StatusBadge({ value }: { value: string }) {
  const tone = statusTone(value)
  return <span className={`status-badge status-${tone}`}>{titleCase(value)}</span>
}

export function ProvenanceBadge({ value }: { value: Provenance }) {
  return <span className={`provenance-badge provenance-${value}`}>{titleCase(value)}</span>
}

export function LoadingBlock({ label = 'Loading data' }: { label?: string }) {
  return (
    <div className="state-block state-loading" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>Waiting for the read-only API.</p>
      </div>
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block state-error" role="alert">
      <span className="state-symbol" aria-hidden="true">!</span>
      <div>
        <strong>Data request failed</strong>
        <p>{message}</p>
        {onRetry ? (
          <button className="secondary-button" type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function UnavailableBlock({
  title = 'Data unavailable',
  reason,
}: {
  title?: string
  reason: string
}) {
  return (
    <div className="state-block state-unavailable" role="status">
      <span className="state-symbol" aria-hidden="true">—</span>
      <div>
        <strong>{title}</strong>
        <p>{reason}</p>
      </div>
    </div>
  )
}

export function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="state-block state-empty" role="status">
      <span className="state-symbol" aria-hidden="true">0</span>
      <div>
        <strong>No matching records</strong>
        <p>{message}</p>
      </div>
    </div>
  )
}

export function DefinitionGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; wide?: boolean; mono?: boolean }>
}) {
  return (
    <dl className="definition-grid">
      {items.map((item) => (
        <div className={item.wide ? 'is-wide' : undefined} key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
