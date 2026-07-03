import { Panel, ProvenanceBadge } from '../components/DataDisplay'
import { publicLinks } from '../config/publicLinks'

interface MethodologyPageProps {
  onNavigate: (path: string) => void
}

interface MethodologySection {
  id: string
  title: string
  summary: string
  points: string[]
}

const sections: MethodologySection[] = [
  {
    id: 'scope',
    title: '1. Scope and principles',
    summary: 'Independent, read-only XRPL Lending Protocol observability on Devnet.',
    points: ['Validated ledger evidence is the factual base.', 'Unavailable data is never replaced with zero or examples.', 'XRP, IOU, and MPT remain distinct.', 'No wallet, signing, transaction submission, credit judgment, or investment recommendation is provided.'],
  },
  {
    id: 'data-sources',
    title: '2. Data sources',
    summary: 'Public XRPL Devnet ledger and server responses are normalized into bounded records.',
    points: ['Current objects come from one complete ledger_data traversal.', 'History comes from validated transactions and metadata.', 'Raw payload availability follows the documented retention policy.'],
  },
  {
    id: 'validated-ledgers',
    title: '3. Validated-ledger selection',
    summary: 'Only validated ledgers become canonical input.',
    points: ['Ledger index and hash are recorded together.', 'Gaps, mismatches, discontinuities, and reset boundaries fail closed.', 'Latest validated and last processed ledgers remain separate facts.'],
  },
  {
    id: 'bootstrap',
    title: '4. Current-state bootstrap',
    summary: 'The initial snapshot is built from one fixed validated Devnet ledger.',
    points: ['Vault, LoanBroker, and Loan objects share one snapshot identity.', 'Objects are written in bounded batches to an inactive D1 snapshot.', 'The manifest records ledger, batch, digest, byte-count, and object-count evidence.', 'Partial scans never become active.'],
  },
  {
    id: 'marker-resume',
    title: '5. Marker resume',
    summary: 'The exact server marker is the continuation contract.',
    points: ['The marker advances only after the corresponding D1 batch is durable.', 'Retries reuse the fixed ledger identity and exact marker.', 'Completion requires the terminal response and a verified complete manifest.'],
  },
  {
    id: 'incremental-collection',
    title: '6. Incremental ledger collection',
    summary: 'Validated ledgers are processed in order and committed idempotently after bootstrap.',
    points: ['Ledger identity, transaction order, and result are recorded before exposure.', 'Gaps and hash discontinuities require reconciliation or a new epoch.', 'Repeated processing must not duplicate canonical records.'],
  },
  {
    id: 'affected-nodes',
    title: '7. AffectedNodes normalization',
    summary: 'Created, modified, and deleted nodes become deterministic object changes.',
    points: ['Each change retains ledger, transaction, object, action, and field context.', 'Before and after values remain typed evidence.', 'Unsupported fields are reported safely.'],
  },
  {
    id: 'asset-normalization',
    title: '8. Asset normalization',
    summary: 'XRP, IOU, and MPT use separate canonical identities and display rules.',
    points: ['IOUs retain currency and issuer together.', 'MPTs retain issuance identity.', 'No unsupported pricing, fiat conversion, or cross-asset total is generated.'],
  },
  {
    id: 'lifecycle',
    title: '9. Lifecycle reconstruction',
    summary: 'Loan lifecycle records come only from collected validated evidence.',
    points: ['Creation, payment, impairment, default, repayment, and deletion require source evidence.', 'Ordering uses epoch, ledger, transaction, and event position.', 'Missing intermediate events are not invented.'],
  },
  {
    id: 'status',
    title: '10. Loan status rules',
    summary: 'On-ledger status and payment-schedule status remain independent.',
    points: ['Before the due time, schedule status is current.', 'During the grace interval, it is payment_due.', 'After the grace interval, it is default_eligible.', 'Default eligibility never rewrites active on-ledger status.'],
  },
  {
    id: 'cover-formulas',
    title: '11. Cover, debt, and loss formulas',
    summary: 'Derived quantities use exact recorded inputs and documented arithmetic.',
    points: ['Vault used assets = AssetsTotal − AssetsAvailable.', 'Debt utilization uses DebtTotal and DebtMaximum.', 'Required cover uses DebtTotal and CoverRateMinimum.', 'LossUnrealized remains a direct recorded value.'],
  },
  {
    id: 'archives',
    title: '12. Deleted-object archive',
    summary: 'Deleted protocol objects remain available as archived evidence where collected.',
    points: ['Final known state and deletion evidence are retained.', 'Archived objects are never presented as current.', 'Unknown deletion classifications remain unknown.'],
  },
  {
    id: 'epochs',
    title: '13. Devnet epoch handling',
    summary: 'Devnet reset eras are represented as explicit epoch boundaries.',
    points: ['Records retain epoch scope.', 'Incompatible histories are not silently combined.', 'Cross-epoch comparison requires visible context.'],
  },
  {
    id: 'provenance',
    title: '14. Provenance categories',
    summary: 'Every user-facing fact is direct, derived, indexed, or unavailable.',
    points: ['Direct means recorded source evidence.', 'Derived means a documented calculation.', 'Indexed means reconstructed history.', 'Unavailable means the fact is not safe to state.'],
  },
  {
    id: 'unavailable-data',
    title: '15. Unavailable and missing data',
    summary: 'Unavailable is a first-class data state.',
    points: ['Before a complete verified D1 snapshot is active, current entity APIs report unavailable.', 'A successful empty result differs from an unavailable index.', 'The UI does not substitute values from another snapshot or guess relationships.'],
  },
  {
    id: 'idempotency',
    title: '16. Idempotency and reconciliation',
    summary: 'Canonical keys and verification checks make repeated collection safe.',
    points: ['Repeated processing converges without duplication.', 'Counts, hashes, and relationships verify before activation.', 'A failed replacement preserves the prior active pointer.'],
  },
  {
    id: 'storage-retention',
    title: '17. Storage and retention',
    summary: 'Current snapshots, history, archives, and raw evidence remain bounded and measurable.',
    points: ['Completed snapshot rows are immutable.', 'The active snapshot and one rollback snapshot are retained within the D1 envelope.', 'Retention changes must not silently alter completeness claims.'],
  },
  {
    id: 'api-exports',
    title: '18. API and export behavior',
    summary: 'Public access is read-only, bounded, and Devnet-scoped.',
    points: ['Limits are validated and capped.', 'Search uses bounded exact matching.', 'Activity exports support bounded JSON, NDJSON, and CSV.'],
  },
  {
    id: 'limitations',
    title: '19. Known limitations',
    summary: 'The interface states what has not yet been proven or collected.',
    points: ['Devnet may reset and is not equivalent to Mainnet.', 'Current entity data remains unavailable until a complete verified D1 snapshot is activated.', 'No market price, fiat value, credit model, risk model, or off-chain identity source is used.'],
  },
  {
    id: 'verification',
    title: '20. Verification and release process',
    summary: 'Automated checks are followed by integrity, resource, accessibility, security, and soak evidence.',
    points: ['Changes run lint, type checks, unit tests, local migrations, build, and browser tests.', 'Public release requires resource measurements and multi-day soak evidence.'],
  },
]

export function MethodologyPage({ onNavigate }: MethodologyPageProps) {
  return (
    <article className="page-stack documentation-page" id="top">
      <header className="page-header documentation-hero">
        <div>
          <p className="page-kicker">System</p>
          <h1>Methodology</h1>
          <p className="page-summary">How the monitor selects evidence, builds current state, normalizes history, derives values, preserves deletions and epochs, and exposes limitations.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => onNavigate('/api')}>API documentation</button>
          {publicLinks.repository ? <a className="secondary-button" href={publicLinks.repository}>Source repository</a> : null}
        </div>
      </header>

      <div className="methodology-layout">
        <nav className="documentation-toc" aria-label="Methodology table of contents">
          <h2>Contents</h2>
          <ol>{sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s*/, '')}</a></li>)}</ol>
        </nav>

        <div className="methodology-content">
          <Panel title="Evidence boundary" description="The rule that governs every section">
            <div className="provenance-key">
              <div><ProvenanceBadge value="direct" /><p>Recorded source fact.</p></div>
              <div><ProvenanceBadge value="derived" /><p>Transparent calculation.</p></div>
              <div><ProvenanceBadge value="indexed" /><p>Reconstructed historical evidence.</p></div>
              <div><ProvenanceBadge value="unavailable" /><p>Not safe to state as fact.</p></div>
            </div>
          </Panel>

          {sections.map((section) => (
            <section className="documentation-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-heading`}>
              <h2 id={`${section.id}-heading`}>{section.title}</h2>
              <p className="documentation-section-summary">{section.summary}</p>
              <ul className="documentation-list">{section.points.map((point) => <li key={point}>{point}</li>)}</ul>
              <a className="back-to-contents" href="#top">Back to top</a>
            </section>
          ))}
        </div>
      </div>
    </article>
  )
}
