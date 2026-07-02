import { Panel, UnavailableBlock } from '../components/DataDisplay'
import { publicLinks } from '../config/publicLinks'

interface ContactPageProps {
  onNavigate: (path: string) => void
}

export function ContactPage({ onNavigate }: ContactPageProps) {
  return (
    <article className="page-stack documentation-page">
      <header className="page-header documentation-hero">
        <div>
          <p className="page-kicker">Project</p>
          <h1>Contact</h1>
          <p className="page-summary">
            Use the route that matches the sensitivity and public nature of the report. Only configured destinations are shown as active actions.
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => onNavigate('/about')}>About the project</button>
          <button className="secondary-button" type="button" onClick={() => onNavigate('/methodology')}>Methodology</button>
        </div>
      </header>

      <div className="contact-option-grid">
        <section className="contact-option" aria-labelledby="private-contact-heading">
          <p className="page-kicker">General or private inquiry</p>
          <h2 id="private-contact-heading">Configured contact form</h2>
          <p>
            Use this route for general questions or information that should not be placed in a public issue. A destination is enabled only after its URL is explicitly configured.
          </p>
          {publicLinks.contactForm ? (
            <a className="primary-button" href={publicLinks.contactForm}>Open contact form</a>
          ) : (
            <UnavailableBlock
              title="Private contact form unavailable"
              reason="No general or private inquiry form is currently configured. Do not substitute a public issue for confidential material."
            />
          )}
        </section>

        <section className="contact-option" aria-labelledby="public-contact-heading">
          <p className="page-kicker">Public technical report</p>
          <h2 id="public-contact-heading">GitHub Issues</h2>
          <p>
            Use a public issue for reproducible software bugs, factual data corrections, API behavior, documentation problems, accessibility defects, or feature requests that can be discussed openly.
          </p>
          {publicLinks.githubIssues ? (
            <a className="primary-button" href={publicLinks.githubIssues}>Open GitHub Issues</a>
          ) : (
            <UnavailableBlock
              title="Public issue tracker unavailable"
              reason="No public issue destination is currently configured."
            />
          )}
        </section>
      </div>

      <div className="privacy-warning" role="note" aria-labelledby="privacy-warning-heading">
        <div aria-hidden="true">!</div>
        <div>
          <h2 id="privacy-warning-heading">Do not publish confidential or personal information</h2>
          <p>
            GitHub Issues are public. Never post wallet seeds, private keys, credentials, access tokens, personal data, private correspondence, non-public infrastructure details, or security information that would create risk if disclosed.
          </p>
          <p>
            When no private contact route is configured, retain the sensitive details rather than placing them in a public issue. A public report may describe a non-sensitive symptom without including secrets or exploit-enabling information.
          </p>
        </div>
      </div>

      <Panel title="What makes a useful public report">
        <ul className="documentation-list">
          <li>A concise title describing the affected page, endpoint, record, or document.</li>
          <li>The exact public URL, route, Devnet epoch, ledger index, object identifier, or transaction hash when relevant.</li>
          <li>What was observed and what the published specification or API contract led you to expect.</li>
          <li>Browser, viewport, and assistive-technology details for UI or accessibility defects.</li>
          <li>Public source evidence for a factual correction. Do not include private records.</li>
          <li>Redacted reproduction steps that do not contain credentials, personal data, or harmful operational details.</li>
        </ul>
      </Panel>

      <Panel title="Before reporting a data difference">
        <div className="documentation-card-grid">
          <div className="documentation-card"><h3>Check network and epoch</h3><p>The initial product is Devnet-only, and Devnet resets create separate historical epochs.</p></div>
          <div className="documentation-card"><h3>Check provenance</h3><p>Direct, Derived, Indexed, and Unavailable records have different evidence boundaries.</p></div>
          <div className="documentation-card"><h3>Check freshness</h3><p>Latest validated ledger and last processed ledger can differ while the collector catches up.</p></div>
          <div className="documentation-card"><h3>Check current versus archived</h3><p>An indexed or archived relationship does not prove that the object remains current.</p></div>
        </div>
      </Panel>
    </article>
  )
}
