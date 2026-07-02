import { Panel, ProvenanceBadge } from '../components/DataDisplay'
import { publicLinks } from '../config/publicLinks'

interface MethodologyPageProps {
  onNavigate: (path: string) => void
}

interface MethodologySection {
  id: string
  title: string
  summary: string
  paragraphs?: string[]
  points?: string[]
}

const sections: MethodologySection[] = [
  {
    id: 'scope',
    title: '1. Scope and principles',
    summary: 'The monitor is an independent, read-only observability and audit layer for the XRPL Lending Protocol on Devnet.',
    points: [
      'Validated ledger evidence is the factual base. The UI never replaces unavailable data with example values or zero.',
      'Current objects, indexed history, archived objects, and derived calculations remain visibly separate.',
      'XRP, IOU, and MPT identities and quantities remain distinct unless a future approved pricing subsystem explicitly permits comparison.',
      'No wallet connection, signing, transaction submission, lending action, administration action, credit judgment, or investment recommendation is performed.',
    ],
  },
  {
    id: 'data-sources',
    title: '2. Data sources',
    summary: 'Collection uses public XRPL Devnet ledger and server responses, then stores bounded normalized records and evidence.',
    points: [
      'Network and amendment state comes from public server responses where safe to expose.',
      'Current-state objects come from a complete ledger_data traversal fixed to one validated ledger.',
      'Historical events come from committed validated ledger transactions and metadata.',
      'Source transaction and metadata payloads are retained only where the documented storage policy and collector evidence say they are retained.',
    ],
  },
  {
    id: 'validated-ledgers',
    title: '3. Validated-ledger selection',
    summary: 'Only validated ledgers are accepted as canonical monitoring input.',
    paragraphs: [
      'A collection unit records the ledger index and hash together. A later mismatch, gap, reorganization-like discontinuity, or reset boundary is not silently merged into the same epoch.',
      'The latest validated ledger shown by the server and the last ledger committed by the collector are separate facts. Their difference contributes to freshness and lag reporting.',
    ],
  },
  {
    id: 'bootstrap',
    title: '4. Current-state bootstrap',
    summary: 'The initial current snapshot is built from one fixed validated Devnet ledger and activated only after complete verification.',
    points: [
      'Vault, LoanBroker, and Loan objects are classified from the same traversal and snapshot identity.',
      'Objects are written into deterministic bounded shards before activation.',
      'A manifest records snapshot, epoch, ledger, shard, digest, byte-count, and object-count evidence.',
      'Partial scans never become the active public snapshot.',
    ],
  },
  {
    id: 'marker-resume',
    title: '5. Marker resume',
    summary: 'Long ledger_data traversals use the exact server marker as the continuation contract.',
    points: [
      'A continuation marker is persisted only after the corresponding shard write is durable.',
      'Retries reuse the exact marker and fixed ledger identity rather than restarting from a moving latest ledger.',
      'Completion requires the terminal response, all expected shards, and a verified complete manifest.',
    ],
  },
  {
    id: 'incremental-collection',
    title: '6. Incremental ledger collection',
    summary: 'After bootstrap, validated ledgers are processed in canonical order and committed idempotently.',
    points: [
      'Ledger index, hash, close time, transaction order, and result are recorded before normalized protocol changes are exposed.',
      'Gaps and hash discontinuities fail closed and require reconciliation or a new epoch boundary.',
      'Repeated processing must not duplicate canonical events, object changes, lifecycle records, or archives.',
    ],
  },
  {
    id: 'affected-nodes',
    title: '7. AffectedNodes normalization',
    summary: 'Transaction metadata AffectedNodes are converted into deterministic created, modified, and deleted object changes.',
    points: [
      'Each normalized change retains transaction, ledger, epoch, node, object, action, and field context.',
      'Before and after values remain typed JSON evidence rather than flattened prose.',
      'Unsupported fields are marked as unsupported instead of being discarded or reinterpreted.',
      'Recognized Vault, LoanBroker, Loan, account, borrower, asset, and MPT relationships are indexed for bounded search and linking.',
    ],
  },
  {
    id: 'asset-normalization',
    title: '8. Asset normalization',
    summary: 'XRP, IOU, and MPT assets use separate canonical identities and display rules.',
    points: [
      'XRP quantities retain XRP-specific scale and identity.',
      'IOUs retain currency and issuer together; a currency code alone is not treated as a complete identity.',
      'MPT assets retain their issuance identifier and available label metadata.',
      'No unsupported price, fiat conversion, or cross-asset total is generated.',
    ],
  },
  {
    id: 'lifecycle',
    title: '9. Lifecycle reconstruction',
    summary: 'Loan lifecycle records are reconstructed only from collected validated changes and recognized transaction evidence.',
    points: [
      'Creation, payment, management, impairment, unimpairment, default, repayment, and deletion events are recorded only when supported by source evidence.',
      'Canonical ordering uses epoch, ledger, transaction, and event position.',
      'Missing ledgers or unsupported intermediate states are not filled with inferred events.',
      'Lifecycle completeness remains bounded by the documented collection start, reset boundaries, reconciliation, and retention evidence.',
    ],
  },
  {
    id: 'status',
    title: '10. Loan status rules',
    summary: 'Direct on-ledger status and derived payment-schedule status are independent models.',
    points: [
      'On-ledger status is normalized from the recorded Loan object flags and deletion evidence.',
      'Before NextPaymentDueDate, schedule status is current.',
      'At the due time and before due time plus GracePeriod, schedule status is payment_due.',
      'At or after due time plus GracePeriod, schedule status is default_eligible.',
      'When PaymentRemaining is zero, schedule status is complete.',
      'Invalid or unavailable schedule inputs produce unknown rather than an inferred state.',
      'Default eligibility never changes an active on-ledger Loan into a displayed on-ledger default.',
    ],
  },
  {
    id: 'cover-formulas',
    title: '11. Cover, debt, and loss formulas',
    summary: 'Derived quantities use recorded protocol fields and documented integer arithmetic; every derived value is labeled.',
    points: [
      'Vault used assets = AssetsTotal − AssetsAvailable when both values are valid and comparable.',
      'Vault utilization is used assets divided by AssetsTotal, expressed in basis points when the denominator is valid and non-zero.',
      'Broker debt utilization is DebtTotal divided by DebtMaximum, expressed in basis points when DebtMaximum is present and non-zero.',
      'Required minimum cover uses DebtTotal and the recorded CoverRateMinimum under the canonical rate scaling defined by the implementation.',
      'Cover surplus or shortfall = CoverAvailable − required minimum cover when every input is available.',
      'LossUnrealized is displayed as a direct recorded value; the monitor does not invent liquidation or recovery predictions.',
    ],
  },
  {
    id: 'archives',
    title: '12. Deleted-object archive',
    summary: 'Deleted Vault, LoanBroker, and Loan objects are preserved as archived evidence rather than disappearing from history.',
    points: [
      'The final known state, deletion ledger, transaction, epoch, normalized removal, and relationships are retained where collected.',
      'Archived objects are visibly labeled and are not presented as current objects.',
      'Unknown deletion classifications remain unknown.',
      'Current and archived links are resolved only when the evidence supports the relationship.',
    ],
  },
  {
    id: 'epochs',
    title: '13. Devnet epoch handling',
    summary: 'Devnet resets are represented as explicit epoch boundaries so unrelated ledger histories are never mixed.',
    points: [
      'Each epoch records its first ledger identity and current or archived state.',
      'A reset, incompatible ledger history, or approved restart creates a new epoch rather than rewriting prior evidence.',
      'Objects, activity, lifecycle records, archives, and cursors retain epoch scope.',
      'Cross-epoch comparisons require an explicit user-visible context.',
    ],
  },
  {
    id: 'provenance',
    title: '14. Provenance categories',
    summary: 'Every user-facing fact belongs to one of four provenance categories.',
    points: [
      'Direct: read from a validated ledger object, transaction, metadata record, or directly recorded collector state.',
      'Derived: calculated from direct values using a documented formula.',
      'Indexed: reconstructed or linked from collected historical evidence.',
      'Unavailable: unsupported, not collected, not activated, stale beyond the accepted boundary, or otherwise not safe to state as fact.',
    ],
  },
  {
    id: 'unavailable-data',
    title: '15. Unavailable and missing data',
    summary: 'Unavailable is a first-class data state, not a cosmetic error or zero value.',
    points: [
      'Before an active snapshot and public object-shard binding exist, current entity APIs return an explicit unavailable state and reason.',
      'An empty successful result means the bounded index was available and found no match; it is different from an unavailable index.',
      'Partial retained payloads, unsupported fields, stale collection, and failed verification are separately disclosed.',
      'The UI does not substitute mock values, cached values from another snapshot, or guessed relationships.',
    ],
  },
  {
    id: 'idempotency',
    title: '16. Idempotency and reconciliation',
    summary: 'Canonical keys and verification checks make repeated collection safe and expose inconsistencies before release.',
    points: [
      'Repeated ledger processing must converge on the same event and change records without duplication.',
      'Current projections, lifecycle records, archives, cover histories, and ledger cursors are reconciled against source evidence.',
      'Snapshot digests, byte counts, object counts, and relationship boundaries are verified before activation.',
      'Failed replacement preserves the prior active snapshot pointer.',
    ],
  },
  {
    id: 'storage-retention',
    title: '17. Storage and retention',
    summary: 'Storage is bounded, measurable, and separated by current snapshot, normalized history, archives, and retained raw evidence.',
    points: [
      'Current object shards are immutable snapshot artifacts referenced by a manifest.',
      'Normalized history and operational state use bounded database records and indexes.',
      'Raw transaction and metadata availability is disclosed per endpoint and record.',
      'Retention or resource limits must not silently change a historical-completeness claim.',
    ],
  },
  {
    id: 'api-exports',
    title: '18. API and export behavior',
    summary: 'Public access is read-only, bounded, Devnet-scoped, and designed to preserve provenance and availability states.',
    points: [
      'Collection limits are validated and capped; current-state cursors are opaque.',
      'Search performs bounded exact matching over indexed fields.',
      'Activity exports support JSON, NDJSON, and CSV; the feed is bounded NDJSON.',
      'Raw transaction or metadata payloads are exposed only on supported detail responses and only when retained.',
    ],
  },
  {
    id: 'limitations',
    title: '19. Known limitations',
    summary: 'The public interface states what has not yet been proven or collected.',
    points: [
      'The initial network is Devnet, whose state may reset and is not equivalent to Mainnet production activity.',
      'Current entity data remains unavailable until a complete verified snapshot is activated with the required binding.',
      'Lifecycle and archive completeness begins at the documented collection boundary and depends on reconciliation evidence.',
      'No external market price, fiat value, credit model, risk model, or off-chain identity source is used.',
      'A displayed relationship means the indexed or current ledger record contains that value; it does not prove real-world control or affiliation.',
    ],
  },
  {
    id: 'verification',
    title: '20. Verification and release process',
    summary: 'Implementation units pass automated quality checks, then release gates add integration, accessibility, integrity, resource, and soak evidence.',
    points: [
      'Every implementation pull request runs lint, TypeScript checks, unit tests, local D1 migrations, a production build, and browser tests.',
      'Checkpoint C confirms the ordinary baseline monitor before audit-only views are promoted.',
      'Mainnet, production deployment, remote resource creation, and public write operations require separate explicit approval.',
      'A public Devnet release additionally requires integrity simulations, resource measurements, accessibility and security review, operational documentation, and multi-day soak evidence.',
    ],
  },
]

export function MethodologyPage({ onNavigate }: MethodologyPageProps) {
  return (
    <article className="page-stack documentation-page">
      <header className="page-header documentation-hero">
        <div>
          <p className="page-kicker">System</p>
          <h1>Methodology</h1>
          <p className="page-summary">
            How XRPL Lending Monitor selects validated evidence, builds current state, normalizes history, derives transparent values, preserves deletions and epochs, and exposes limitations.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => onNavigate('/api')}>API documentation</button>
          {publicLinks.repository ? <a className="secondary-button" href={publicLinks.repository}>Source repository</a> : null}
        </div>
      </header>

      <div className="methodology-layout">
        <nav className="documentation-toc" aria-label="Methodology table of contents">
          <h2>Contents</h2>
          <ol>
            {sections.map((section) => (
              <li key={section.id}><a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s*/, '')}</a></li>
            ))}
          </ol>
        </nav>

        <div className="methodology-content">
          <Panel title="Evidence boundary" description="The concise rule that governs every section">
            <div className="provenance-key">
              <div><ProvenanceBadge value="direct" /><p>Recorded validated-ledger or collector fact.</p></div>
              <div><ProvenanceBadge value="derived" /><p>Transparent calculation from direct inputs.</p></div>
              <div><ProvenanceBadge value="indexed" /><p>Reconstructed historical evidence.</p></div>
              <div><ProvenanceBadge value="unavailable" /><p>Not safe or supported to state as fact.</p></div>
            </div>
          </Panel>

          {sections.map((section) => (
            <section className="documentation-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-heading`}>
              <h2 id={`${section.id}-heading`}>{section.title}</h2>
              <p className="documentation-section-summary">{section.summary}</p>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.points ? <ul className="documentation-list">{section.points.map((point) => <li key={point}>{point}</li>)}</ul> : null}
              <a className="back-to-contents" href="#top">Back to top</a>
            </section>
          ))}
        </div>
      </div>
    </article>
  )
}
