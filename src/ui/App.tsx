const plannedSurfaces = [
  'Protocol overview and network health',
  'Vault and Loan Broker monitoring',
  'Loan schedules and on-ledger state',
  'Activity, search, and transaction changes',
  'Lifecycle history and deleted-object archive',
  'Devnet epochs and data provenance',
]

export function App() {
  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Devnet first · read-only</p>
          <h1>XRPL Lending Monitor</h1>
          <p className="summary">
            A complete XRPL Lending monitoring surface with historical lifecycle,
            deleted-object, cover, and state-transition auditing.
          </p>
        </div>
        <span className="status">Foundation ready</span>
      </header>

      <section className="notice" aria-labelledby="current-status">
        <h2 id="current-status">Current implementation status</h2>
        <p>
          The repository foundation is active. Collector, D1 projections, public
          monitoring data, and final interface pages have not been implemented yet.
        </p>
      </section>

      <section aria-labelledby="planned-coverage">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Required product coverage</p>
            <h2 id="planned-coverage">Baseline monitor plus audit history</h2>
          </div>
          <a href="/api/status">API status</a>
        </div>

        <div className="grid">
          {plannedSurfaces.map((surface) => (
            <article className="card" key={surface}>
              <span aria-hidden="true">→</span>
              <p>{surface}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        No wallet connection, signing, lending, repayment, or investment advice.
      </footer>
    </main>
  )
}
