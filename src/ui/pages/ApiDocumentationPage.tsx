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
  { method: 'GET', path: '/api/vaults', purpose: 'Bounded current Vault collection with exact asset identity, sorting, search, filters, and opaque cursor pagination.', availability: 'Requires a verified active snapshot and CURRENT_STATE binding.' },
  { method: 'GET', path: '/api/vaults/{vaultId}', purpose: 'Verified current Vault detail and retained raw object fields.', availability: 'Requires a verified active snapshot and CURRENT_STATE binding.' },
  { method: 'GET', path: '/api/loan-brokers', purpose: 'Bounded current Loan Broker collection with same-snapshot Vault and canonical asset relationships.', availability: 'Requires a verified active snapshot and CURRENT_STATE binding.' },
  { method: 'GET', path: '/api/loan-brokers/{brokerId}', purpose: 'Verified current Loan Broker detail, debt and cover calculations, relationship provenance, and raw fields.', availability: 'Requires a verified active snapshot and CURRENT_STATE binding.' },
  { method: 'GET', path: '/api/loans', purpose: 'Bounded current Loan collection with factual search, state filters, same-snapshot relationships, and exact amounts.', availability: 'Requires a verified active snapshot and CURRENT_STATE binding.' },
  { method: 'GET', path: '/api/loans/{loanId}', purpose: 'Verified current Loan detail with separate on-ledger and schedule states, terms, payments, relationships, and raw fields.', availability: 'Requires a verified active snapshot and CURRENT_STATE binding.' },
  { method: 'GET', path: '/api/activity', purpose: 'Latest bounded indexed protocol-event window.' },
  { method: 'GET', path: '/api/transactions/{hash}', purpose: 'Transaction event, affected object changes, relationships, provenance, and retained raw payloads where available.' },
  { method: 'GET', path: '/api/epochs', purpose: 'Current and archived Devnet epoch records.' },
  { method: 'GET', path: '/api/objects/{objectType}/{objectId}/history', purpose: 'Bounded normalized object-change history.' },
  { method: 'GET', path: '/api/loans/{loanId}/lifecycle', purpose: 'Bounded canonical Loan lifecycle sequence.' },
  { method: 'GET', path: '/api/search', purpose: 'Bounded exact-match indexed search across transaction, relationship, archive, lifecycle, account, asset, and identifier fields.' },
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
          <p className="page-summary">
            Bounded Devnet monitoring and audit endpoints with explicit network, epoch, provenance, pagination, availability, and validation semantics.
          </p>
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
          <div className="documentation-card"><h3>Read-only</h3><p>The public API exposes GET endpoints only. It does not sign, submit, mutate, administer, borrow, repay, deposit, or withdraw.</p></div>
          <div className="documentation-card"><h3>Bounded</h3><p>Collection limits are validated from 1 through 100. Unsupported limits return a client error.</p></div>
          <div className="documentation-card"><h3>Provenance</h3><p>Responses distinguish direct, derived, indexed, and unavailable data.</p></div>
        </div>
        <dl className="documentation-definition-list">
          <div><dt>Epoch</dt><dd>Devnet history boundary. Records from different epochs must not be silently combined.</dd></div>
          <div><dt>Cursor</dt><dd>Current-state collection cursors are opaque continuation tokens. Clients must not parse or edit them.</dd></div>
          <div><dt>Pagination</dt><dd>The response page object reports the accepted limit and next cursor when the contract supports continuation.</dd></div>
          <div><dt>Freshness</dt><dd>Latest validated ledger, last processed ledger, collector status, last success, and data age are separate facts.</dd></div>
          <div><dt>Raw evidence</dt><dd>Raw current object data or transaction payloads appear only on supported detail responses and only when retained.</dd></div>
        </dl>
      </section>

      <section className="documentation-section" id="endpoints" aria-labelledby="api-endpoints-heading">
        <h2 id="api-endpoints-heading">Endpoint reference</h2>
        <div className="api-endpoint-table-wrapper">
          <table className="api-endpoint-table">
            <thead><tr><th>Method</th><th>Path</th><th>Purpose and availability</th></tr></thead>
            <tbody>
              {endpoints.map((endpoint) => (
                <tr key={endpoint.path}>
                  <td><StatusBadge value={endpoint.method} /></td>
                  <td><code>{endpoint.path}</code></td>
                  <td><p>{endpoint.purpose}</p>{endpoint.availability ? <small>{endpoint.availability}</small> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="documentation-section" id="current-state" aria-labelledby="api-current-heading">
        <h2 id="api-current-heading">Current-state collections and details</h2>
        <p>
          Vault, Loan Broker, and Loan reads are verified against one active snapshot. Relationships are resolved only inside that same snapshot, and canonical asset identity is inherited through the verified relationship chain.
        </p>
        <ul className="documentation-list">
          <li><code>limit</code>: integer from 1 through 100.</li>
          <li><code>sort</code>: supported current object collections use <code>id_asc</code> or <code>id_desc</code>.</li>
          <li><code>q</code>: factual bounded query; the current route contract caps it at 128 characters.</li>
          <li><code>cursor</code>: opaque continuation token, capped at 1,024 characters before decoding or verification.</li>
          <li>Loan filters keep <code>on_ledger_status</code> and <code>schedule_status</code> separate.</li>
          <li>Before snapshot activation or binding availability, the response is successful but explicitly marks the collection or detail unavailable. It does not return fabricated empty current state.</li>
        </ul>
        <CodeExample>{`GET /api/loans?limit=25&sort=id_asc&on_ledger_status=active&schedule_status=payment_due`}</CodeExample>
      </section>

      <section className="documentation-section" id="activity" aria-labelledby="api-activity-heading">
        <h2 id="api-activity-heading">Activity, transaction, epoch, history, and lifecycle</h2>
        <p>
          History endpoints read normalized indexed evidence. The initial Activity collection is the latest bounded event window and currently reports <code>next_cursor: null</code>; UI filters operate inside that disclosed window.
        </p>
        <ul className="documentation-list">
          <li>Transaction detail groups the indexed event and up to the bounded normalized object changes returned by the route.</li>
          <li>Object history is scoped by exact object type and identifier.</li>
          <li>Loan lifecycle ordering is canonical within the collected epoch and never fills unsupported intermediate events.</li>
          <li>Epoch records expose current and archived Devnet boundaries.</li>
          <li>Indexed evidence does not prove that a referenced object remains current.</li>
        </ul>
        <CodeExample>{`GET /api/activity?limit=100
GET /api/transactions/{64-character-hash}
GET /api/objects/Loan/{loanId}/history?limit=100
GET /api/loans/{loanId}/lifecycle?limit=100`}</CodeExample>
      </section>

      <section className="documentation-section" id="search" aria-labelledby="api-search-heading">
        <h2 id="api-search-heading">Exact indexed search</h2>
        <p>
          <code>/api/search</code> requires a non-empty <code>q</code> value and performs exact matching across supported indexed transaction hashes, object identifiers, Vault, Loan Broker and Loan relationships, accounts, owners, borrowers, canonical asset keys, MPT issuance IDs, archives, and Loan lifecycle records.
        </p>
        <ul className="documentation-list">
          <li>A successful empty <code>data</code> array means the index was queried and no exact match was found.</li>
          <li>An unavailable or failed request is not equivalent to no result.</li>
          <li>Result kinds include transaction, object_change, archived_object, and loan_lifecycle.</li>
          <li>Account matches are ledger relationships only and carry no off-chain identity or affiliation claim.</li>
        </ul>
        <CodeExample>{`GET /api/search?q={url-encoded-exact-value}&limit=100`}</CodeExample>
      </section>

      <section className="documentation-section" id="exports" aria-labelledby="api-exports-heading">
        <h2 id="api-exports-heading">Exports and feeds</h2>
        <p>Activity exports are bounded views of normalized indexed events and do not include retained raw transaction metadata.</p>
        <div className="documentation-link-grid">
          <div><h3>JSON</h3><p>Structured response with network, data, provenance, and page metadata.</p><a href="/api/exports/activity?format=json&limit=100">Open JSON export</a></div>
          <div><h3>NDJSON</h3><p>One normalized Activity event per line for streaming or line-oriented processing.</p><a href="/api/exports/activity?format=ndjson&limit=100">Open NDJSON export</a></div>
          <div><h3>CSV</h3><p>Bounded tabular Activity fields with CSV escaping.</p><a href="/api/exports/activity?format=csv&limit=100">Open CSV export</a></div>
          <div><h3>Feed</h3><p>Bounded NDJSON feed of the latest indexed Activity window.</p><a href="/api/feeds/activity.ndjson?limit=100">Open NDJSON feed</a></div>
        </div>
      </section>

      <section className="documentation-section" id="errors" aria-labelledby="api-errors-heading">
        <h2 id="api-errors-heading">Validation, unavailable state, and errors</h2>
        <dl className="documentation-definition-list">
          <div><dt>400</dt><dd>Invalid limit, sort, filter, cursor, query, identifier, or export format.</dd></div>
          <div><dt>404</dt><dd>A valid detail identifier or API route was not found in the available indexed or active context.</dd></div>
          <div><dt>503</dt><dd>The active current-state snapshot could not be verified for a public read.</dd></div>
          <div><dt>500</dt><dd>An unexpected API failure. Public responses return a bounded generic message rather than internal details.</dd></div>
          <div><dt>Unavailable payload</dt><dd>A normal JSON response can explicitly state that current data is unavailable before activation. Clients must inspect availability and provenance, not only HTTP status.</dd></div>
        </dl>
      </section>

      <section className="documentation-section" id="examples" aria-labelledby="api-examples-heading">
        <h2 id="api-examples-heading">Clearly labeled example shapes</h2>
        <p className="example-warning"><strong>Illustrative shape only.</strong> The identifiers, ledger values, and counts below are not live protocol data.</p>
        <CodeExample>{`{
  "network": "devnet",
  "data": [],
  "page": {
    "limit": 25,
    "next_cursor": null
  },
  "availability": {
    "state": "unavailable",
    "reason": "active current-state snapshot has not been activated"
  },
  "provenance": {
    "collection": "unavailable"
  }
}`}</CodeExample>
        <div className="provenance-key">
          <div><ProvenanceBadge value="direct" /><p>Recorded fact.</p></div>
          <div><ProvenanceBadge value="derived" /><p>Documented calculation.</p></div>
          <div><ProvenanceBadge value="indexed" /><p>Historical reconstruction.</p></div>
          <div><ProvenanceBadge value="unavailable" /><p>Not available as fact.</p></div>
        </div>
      </section>
    </article>
  )
}
