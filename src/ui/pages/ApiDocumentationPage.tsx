import { ProvenanceBadge, StatusBadge } from '../components/DataDisplay'
import { publicLinks } from '../config/publicLinks'

interface ApiDocumentationPageProps {
  onNavigate: (path: string) => void
}

interface Endpoint {
  method: 'GET'
  path: string
  purpose: string
  availability?: string
}

const endpoints: Endpoint[] = [
  { method: 'GET', path: '/api/health', purpose: 'Service, network, and Mainnet-enable health boundary.' },
  { method: 'GET', path: '/api/status', purpose: 'Devnet server, amendment, epoch, collector, freshness, and public-safe error state.' },
  { method: 'GET', path: '/api/overview', purpose: 'Baseline counts, active snapshot, network context, freshness, provenance, and unavailable reasons.' },
  { method: 'GET', path: '/api/vaults', purpose: 'Bounded current Vault collection.', availability: 'Requires a complete verified active D1 snapshot.' },
  { method: 'GET', path: '/api/vaults/{vaultId}', purpose: 'Verified current Vault detail and retained raw object fields.', availability: 'Requires a complete verified active D1 snapshot.' },
  { method: 'GET', path: '/api/loan-brokers', purpose: 'Bounded current Loan Broker collection with same-snapshot Vault relationships.', availability: 'Requires a complete verified active D1 snapshot.' },
  { method: 'GET', path: '/api/loan-brokers/{brokerId}', purpose: 'Current Loan Broker detail, calculations, relationships, and raw fields.', availability: 'Requires a complete verified active D1 snapshot.' },
  { method: 'GET', path: '/api/loans', purpose: 'Bounded current Loan collection with factual search, state filters, relationships, and exact amounts.', availability: 'Requires a complete verified active D1 snapshot.' },
  { method: 'GET', path: '/api/loans/{loanId}', purpose: 'Current Loan detail with on-ledger and schedule states, terms, payments, relationships, and raw fields.', availability: 'Requires a complete verified active D1 snapshot.' },
  { method: 'GET', path: '/api/activity', purpose: 'Latest bounded indexed protocol-event window.' },
  { method: 'GET', path: '/api/transactions/{hash}', purpose: 'Transaction event, object changes, relationships, provenance, and retained raw payloads where available.' },
  { method: 'GET', path: '/api/epochs', purpose: 'Current and archived Devnet epoch records.' },
  { method: 'GET', path: '/api/epochs/{epochId}', purpose: 'Epoch boundary metadata, indexed counts, provenance, and current-object availability.' },
  { method: 'GET', path: '/api/objects/{objectType}/{objectId}/history', purpose: 'Bounded normalized object-change history.' },
  { method: 'GET', path: '/api/loans/{loanId}/lifecycle', purpose: 'Bounded canonical Loan lifecycle sequence.' },
  { method: 'GET', path: '/api/audit/lifecycle', purpose: 'Protocol-wide bounded Loan lifecycle event explorer.' },
  { method: 'GET', path: '/api/audit/archived', purpose: 'Bounded archived Vault, Loan Broker, and Loan explorer.' },
  { method: 'GET', path: '/api/audit/archived/{objectType}/{objectId}', purpose: 'Archived final state, deletion event, relationships, raw retained data, and provenance.' },
  { method: 'GET', path: '/api/audit/cover-loss', purpose: 'Bounded asset-separated debt, cover, required-cover, surplus, and loss history.' },
  { method: 'GET', path: '/api/search', purpose: 'Bounded exact-match indexed search across supported identifiers and relationships.' },
  { method: 'GET', path: '/api/exports/activity', purpose: 'Bounded Activity export in JSON, NDJSON, or CSV.' },
  { method: 'GET', path: '/api/feeds/activity.ndjson', purpose: 'Bounded NDJSON Activity feed.' },
]

function CodeExample({ children }: { children: string }) {
  return <pre className="code-example"><code>{children}</code></pre>
}

export function ApiDocumentationPage({ onNavigate }: ApiDocumentationPageProps) {
  return (
    <article className="page-stack documentation-page" id="top">
      <header className="page-header documentation-hero">
        <div>
          <p className="page-kicker">System</p>
          <h1>Read-only API</h1>
          <p className="page-summary">Bounded Devnet monitoring and audit endpoints with explicit network, epoch, provenance, pagination, availability, and validation semantics.</p>
          <div className="documentation-badges" aria-label="API boundaries">
            <StatusBadge value="GET only" />
            <StatusBadge value="Devnet" />
            <StatusBadge value="Bounded" />
          </div>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => onNavigate('/methodology#api-exports')}>Methodology</button>
          {publicLinks.repository ? <a className="secondary-button" href={publicLinks.repository}>Source repository</a> : null}
        </div>
      </header>

      <nav className="api-section-navigation" aria-label="API documentation sections">
        <a href="#overview">Overview</a>
        <a href="#endpoints">Endpoints</a>
        <a href="#current-state">Current state</a>
        <a href="#activity">Activity and history</a>
        <a href="#search">Search</a>
        <a href="#exports">Exports</a>
        <a href="#errors">Errors</a>
        <a href="#examples">Examples</a>
      </nav>

      <section className="documentation-section" id="overview" aria-labelledby="api-overview-heading">
        <h2 id="api-overview-heading">Overview and common semantics</h2>
        <div className="documentation-card-grid">
          <div className="documentation-card"><h3>Network</h3><p>All current public records are scoped to XRPL Lending Devnet. Mainnet is disabled.</p></div>
          <div className="documentation-card"><h3>Read-only</h3><p>The public API exposes GET endpoints only.</p></div>
          <div className="documentation-card"><h3>Bounded</h3><p>Collection limits are validated from 1 through 100.</p></div>
          <div className="documentation-card"><h3>Provenance</h3><p>Responses distinguish direct, derived, indexed, and unavailable data.</p></div>
        </div>
        <dl className="documentation-definition-list">
          <div><dt>Epoch</dt><dd>Devnet history boundary. Different epochs are not silently combined.</dd></div>
          <div><dt>Cursor</dt><dd>Opaque continuation token. Clients must not parse or edit it.</dd></div>
          <div><dt>Freshness</dt><dd>Latest validated ledger, last processed ledger, collector status, and data age are separate facts.</dd></div>
          <div><dt>Raw evidence</dt><dd>Raw current object data or transaction payloads appear only where retained and supported.</dd></div>
        </dl>
      </section>

      <section className="documentation-section" id="endpoints" aria-labelledby="api-endpoints-heading">
        <h2 id="api-endpoints-heading">Endpoint reference</h2>
        <div className="api-endpoint-table-wrapper">
          <table className="api-endpoint-table">
            <thead><tr><th>Method</th><th>Path</th><th>Purpose and availability</th></tr></thead>
            <tbody>{endpoints.map((endpoint) => (
              <tr key={endpoint.path}>
                <td><StatusBadge value={endpoint.method} /></td>
                <td><code>{endpoint.path}</code></td>
                <td><p>{endpoint.purpose}</p>{endpoint.availability ? <small>{endpoint.availability}</small> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="documentation-section" id="current-state" aria-labelledby="api-current-heading">
        <h2 id="api-current-heading">Current-state collections and details</h2>
        <p>Vault, Loan Broker, and Loan reads are verified against one active D1 snapshot. Relationships resolve only inside that same snapshot.</p>
        <ul className="documentation-list">
          <li><code>limit</code>: integer from 1 through 100.</li>
          <li><code>sort</code>: supported collections use <code>id_asc</code> or <code>id_desc</code>.</li>
          <li><code>q</code>: bounded factual query.</li>
          <li><code>cursor</code>: opaque bounded continuation token.</li>
          <li>Loan filters keep <code>on_ledger_status</code> and <code>schedule_status</code> separate.</li>
          <li>Before verified snapshot activation, responses explicitly mark current state unavailable rather than returning a fabricated empty collection.</li>
        </ul>
        <CodeExample>{`GET /api/loans?limit=25&sort=id_asc&on_ledger_status=active&schedule_status=payment_due`}</CodeExample>
      </section>

      <section className="documentation-section" id="activity" aria-labelledby="api-activity-heading">
        <h2 id="api-activity-heading">Activity, transactions, epochs, history, and lifecycle</h2>
        <p>History endpoints read normalized indexed evidence. Indexed evidence does not prove that a referenced object remains current.</p>
        <CodeExample>{`GET /api/activity?limit=100
GET /api/transactions/{64-character-hash}
GET /api/objects/Loan/{loanId}/history?limit=100
GET /api/epochs/{epochId}
GET /api/loans/{loanId}/lifecycle?limit=100`}</CodeExample>
      </section>

      <section className="documentation-section" id="search" aria-labelledby="api-search-heading">
        <h2 id="api-search-heading">Exact indexed search</h2>
        <p><code>/api/search</code> requires a non-empty <code>q</code> and performs exact matching over supported indexed identifiers and relationships.</p>
        <ul className="documentation-list">
          <li>A successful empty array means the index was available and no exact match was found.</li>
          <li>An unavailable or failed request is not equivalent to no result.</li>
          <li>Account matches are ledger relationships only and carry no off-chain identity claim.</li>
        </ul>
      </section>

      <section className="documentation-section" id="exports" aria-labelledby="api-exports-heading">
        <h2 id="api-exports-heading">Exports and feeds</h2>
        <p>Activity exports are bounded views of normalized indexed events.</p>
        <div className="documentation-link-grid">
          <div><h3>JSON</h3><a href="/api/exports/activity?format=json&limit=100">Open JSON export</a></div>
          <div><h3>NDJSON</h3><a href="/api/exports/activity?format=ndjson&limit=100">Open NDJSON export</a></div>
          <div><h3>CSV</h3><a href="/api/exports/activity?format=csv&limit=100">Open CSV export</a></div>
          <div><h3>Feed</h3><a href="/api/feeds/activity.ndjson?limit=100">Open NDJSON feed</a></div>
        </div>
      </section>

      <section className="documentation-section" id="errors" aria-labelledby="api-errors-heading">
        <h2 id="api-errors-heading">Validation, unavailable state, and errors</h2>
        <dl className="documentation-definition-list">
          <div><dt>400</dt><dd>Invalid limit, sort, filter, cursor, query, identifier, or export format.</dd></div>
          <div><dt>404</dt><dd>A valid detail identifier or API route was not found in the available context.</dd></div>
          <div><dt>503</dt><dd>The active current-state snapshot could not be verified for a public read.</dd></div>
          <div><dt>500</dt><dd>An unexpected API failure. Public responses use a bounded generic message.</dd></div>
        </dl>
      </section>

      <section className="documentation-section" id="examples" aria-labelledby="api-examples-heading">
        <h2 id="api-examples-heading">Response shape</h2>
        <p>Illustrative shape only. Fields are shown to explain semantics and are not example production facts.</p>
        <CodeExample>{`{
  "network": "devnet",
  "data": [],
  "provenance": "unavailable",
  "page": { "limit": 25, "next_cursor": null }
}`}</CodeExample>
        <div className="documentation-provenance-row">
          <ProvenanceBadge value="direct" />
          <ProvenanceBadge value="derived" />
          <ProvenanceBadge value="indexed" />
          <ProvenanceBadge value="unavailable" />
        </div>
      </section>
    </article>
  )
}
