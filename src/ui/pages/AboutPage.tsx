import { Panel, StatusBadge } from '../components/DataDisplay'
import { publicLinks } from '../config/publicLinks'

interface AboutPageProps {
  onNavigate: (path: string) => void
}

function InternalLink({ path, children, onNavigate }: {
  path: string
  children: string
  onNavigate: (path: string) => void
}) {
  return (
    <a href={path} onClick={(event) => { event.preventDefault(); onNavigate(path) }}>
      {children}
    </a>
  )
}

export function AboutPage({ onNavigate }: AboutPageProps) {
  return (
    <article className="page-stack documentation-page">
      <header className="page-header documentation-hero">
        <div>
          <p className="page-kicker">Project</p>
          <h1>About XRPL Lending Monitor</h1>
          <p className="page-summary">
            An independent, read-only monitor and historical audit layer for the XRPL Lending Protocol, beginning on Devnet.
          </p>
          <div className="documentation-badges" aria-label="Project boundaries">
            <StatusBadge value="Devnet" />
            <StatusBadge value="Read only" />
            <StatusBadge value="Independent" />
          </div>
        </div>
      </header>

      <Panel title="What this project is">
        <div className="prose-stack">
          <p>
            XRPL Lending Monitor turns validated XRPL Lending Protocol objects and transactions into an ordinary monitoring surface: Overview, Vaults, Loan Brokers, Loans, Activity, Search, Account relationships, and Network Status.
          </p>
          <p>
            The same data pipeline is designed to preserve state transitions, deleted objects, Loan lifecycle events, cover and loss changes, source transactions, provenance, and Devnet epoch boundaries for later audit views.
          </p>
        </div>
      </Panel>

      <div className="documentation-card-grid">
        <section className="documentation-card">
          <h2>Why it exists</h2>
          <p>Raw ledger objects are exact but difficult to inspect across relationships and time. This project makes those records readable without replacing the underlying evidence.</p>
        </section>
        <section className="documentation-card">
          <h2>Who it is for</h2>
          <p>General observers, market participants, Broker operators, developers, researchers, and auditors who need factual current state, historical evidence, or machine-readable access.</p>
        </section>
        <section className="documentation-card">
          <h2>What makes it different</h2>
          <p>Current objects and indexed history remain separate. Deleted objects are retained. Every displayed value is labeled Direct, Derived, Indexed, or Unavailable.</p>
        </section>
      </div>

      <Panel title="Initial scope and operating boundary">
        <dl className="documentation-definition-list">
          <div><dt>Network</dt><dd>XRPL Lending Devnet and archived Devnet epochs collected after monitoring begins.</dd></div>
          <div><dt>Mode</dt><dd>Read-only. The application does not connect a wallet, sign, submit, administer, borrow, repay, deposit, withdraw, or transfer.</dd></div>
          <div><dt>Assets</dt><dd>XRP, IOU, and MPT identities and quantities remain separate. No unsupported fiat or cross-asset total is produced.</dd></div>
          <div><dt>Independence</dt><dd>The project is not an official Ripple, XRPL Foundation, validator, Broker, Vault, or lending service.</dd></div>
          <div><dt>Availability</dt><dd>Unavailable, stale, partial, empty, and failed states are shown explicitly rather than replaced with zero or example data.</dd></div>
        </dl>
      </Panel>

      <Panel title="What this project does not provide">
        <ul className="documentation-list">
          <li>Investment, legal, accounting, tax, lending, borrowing, or safety advice.</li>
          <li>A credit score, risk score, default prediction, identity claim, KYC claim, or endorsement.</li>
          <li>A wallet, lending frontend, Broker service, payment service, custody service, or transaction-submission interface.</li>
          <li>Guaranteed completeness before the documented bootstrap, reconciliation, and release gates have passed.</li>
          <li>A substitute for the XRPL protocol specification, source code, validated ledger data, or independent verification.</li>
        </ul>
      </Panel>

      <Panel title="Learn more">
        <div className="documentation-link-grid">
          <div>
            <h3>Methodology</h3>
            <p>Read the collection, normalization, status, archive, provenance, and verification rules.</p>
            <InternalLink path="/methodology" onNavigate={onNavigate}>Open Methodology</InternalLink>
          </div>
          <div>
            <h3>API documentation</h3>
            <p>Review the bounded read-only endpoints, parameters, response states, exports, and feeds.</p>
            <InternalLink path="/api" onNavigate={onNavigate}>Open API documentation</InternalLink>
          </div>
          <div>
            <h3>Contact</h3>
            <p>Report a public technical issue or review the currently configured contact routes.</p>
            <InternalLink path="/contact" onNavigate={onNavigate}>Open Contact</InternalLink>
          </div>
          <div>
            <h3>Source repository</h3>
            <p>Inspect the public specifications, implementation, tests, and project history.</p>
            {publicLinks.repository ? <a href={publicLinks.repository}>Open repository</a> : <span>Repository link unavailable</span>}
          </div>
        </div>
      </Panel>
    </article>
  )
}
