# Product specification

## Product definition

XRPL Lending Monitor is a read-only, independent monitor and historical audit layer for the XRPL Lending Protocol.

It provides the ordinary information expected from a lending monitor—protocol overview, Vaults, Loan Brokers, Loans, activity, search, and network health—then extends that baseline with lifecycle reconstruction, deleted-object archives, state-transition history, first-loss cover tracking, provenance, and Devnet epoch preservation.

The product is not a wallet, lending frontend, broker service, investment product, credit-rating system, payment product, or substitute for the XRPL protocol specification.

## Primary users

### General observers

Need to understand current protocol activity without reading raw ledger objects.

### Depositors and market participants

Need to inspect Vault balances, available assets, Broker debt, first-loss cover, Loan schedules, and material changes. The product does not advise whether to deposit or lend.

### Broker operators and developers

Need exact object fields, transaction history, before-and-after changes, network health, API access, and clear unavailable states.

### Researchers and auditors

Need historical state, deleted objects, Devnet epochs, lifecycle reconstruction, provenance, methodology, and explicit evidence boundaries.

## Product principles

1. **Baseline completeness first.** Differentiators do not replace normal monitoring pages.
2. **Facts before scores.** Show protocol facts and transparent calculations, not proprietary risk grades.
3. **Current state and history are separate.** Current ledger objects and indexed historical records must not be confused.
4. **On-ledger status and schedule status are separate.** A Loan can be default-eligible without being defaulted.
5. **Assets remain distinct.** XRP, IOU, and MPT quantities are not added together without a documented pricing layer.
6. **Every value has provenance.** Direct, Derived, Indexed, or Unavailable.
7. **Deleted does not mean forgotten.** Deleted Vault, LoanBroker, and Loan records remain searchable.
8. **Network context is always visible.** Network, epoch, validated ledger, and synchronization time accompany data.
9. **Read-only by design.** No signing or transaction submission in the initial product.
10. **Bounded and measurable resource use is a release constraint.** Collection and storage remain controlled and observable.
11. **Unavailable is not zero.** Unsupported, uncollected, stale, and failed states are shown explicitly.
12. **Project transparency is part of the product.** About, Methodology, Contact, API documentation, limitations, and evidence boundaries are public.
13. **No funding or payment surface in the current release.** Donation, payment, promotional, wallet, and transaction-submission features are outside scope.
14. **Public discoverability must match verified scope.** Search metadata, canonical URLs, sitemaps, social previews, and structured data describe only real public pages and never imply Mainnet, write capability, pricing, ratings, or unavailable evidence.

## Initial network scope

### Included

- XRPL Lending Devnet;
- archived Devnet epochs created after collection begins.

### Prepared but disabled

- XRPL Mainnet.

Mainnet collection may begin only after both required amendments are verified as active and an approved starting-ledger plan is recorded.

## Canonical information architecture

Public pages are grouped as:

- **Monitor** — Overview, Vaults, Loan Brokers, Loans, Activity, Search;
- **Audit** — Lifecycle, Archived Objects, Cover & Loss, Devnet Epochs;
- **System** — Network Status, API, Methodology;
- **Project** — About and Contact.

Canonical routes, route ownership, navigation, and responsive behavior are defined by the UI source-of-truth documents indexed in `docs/README.md`.

## Required data pages

### Overview — `/`

Must show:

- selected network and epoch;
- amendment status;
- latest validated ledger and age;
- last successful collector run and lag;
- current Vault, LoanBroker, Loan, and current-object counts when available;
- active-snapshot availability;
- Loan counts by on-ledger and schedule state when supported;
- asset-separated Vault totals, available assets, debt, and cover when supported;
- recent protocol activity;
- collection errors, stale-data warnings, reset notices, and unavailable reasons;
- provenance legend;
- links to detailed monitor, audit, and system pages.

A cross-asset total or fiat conversion is prohibited without a documented and approved pricing subsystem.

### Vault list — `/vaults`

Must support bounded search, cursor pagination, sorting, and filters by asset, public/private state, loss presence, connected Broker presence, network, epoch, and archive context where supported.

Core fields include:

- Vault ID;
- asset;
- owner;
- public/private flags;
- AssetsTotal;
- AssetsAvailable;
- AssetsMaximum;
- utilization;
- LossUnrealized;
- connected Broker and Loan information when supported;
- last ledger and update time.

### Vault detail — `/vaults/:vaultId`

Must show:

- current Vault fields suitable for users;
- Share MPT and Domain information;
- calculated used assets and utilization;
- connected Brokers and Loans when supported;
- Deposit, Withdraw, Set, Clawback, and Delete activity;
- historical balance, availability, and loss changes;
- final state and deletion event when archived;
- provenance and raw data after human-readable sections.

### Loan Broker list — `/loan-brokers`

Core fields include:

- LoanBroker ID;
- owner and pseudo-account;
- connected Vault and asset;
- active Loan count when supported;
- DebtTotal and DebtMaximum;
- debt utilization;
- CoverAvailable;
- configured cover rates;
- required minimum cover;
- cover surplus or shortfall;
- ManagementFeeRate;
- impairment and default counts only when directly supported;
- last update.

### Loan Broker detail — `/loan-brokers/:brokerId`

Must show:

- current Broker fields;
- related Vault;
- Loan book when supported;
- DebtTotal and cover history;
- CoverDeposit, CoverWithdraw, CoverClawback, Set, and Delete activity;
- current cover surplus or shortfall;
- archived final state if deleted;
- formula provenance and raw data after summaries.

### Loan list — `/loans`

Must support bounded search, sorting, cursor pagination, and filtering by network, epoch, asset, Vault, Broker, Borrower, on-ledger state, schedule state, and deleted state.

Core fields include:

- Loan ID;
- Borrower;
- Broker;
- Vault and asset;
- on-ledger state;
- schedule state;
- PrincipalOutstanding;
- TotalValueOutstanding;
- PeriodicPayment;
- PaymentRemaining;
- NextPaymentDueDate;
- grace-period end;
- last payment and last update when supported.

### Loan detail — `/loans/:loanId`

Must show:

- terms and relevant rate and fee fields;
- current balances and payment schedule;
- on-ledger state;
- schedule-derived state;
- lifecycle timeline when indexed history is available;
- payment history;
- impair, unimpair, default, and delete events;
- before-and-after field changes;
- related Broker and Vault;
- raw identifiers and source transactions;
- final state after deletion;
- provenance and unavailable explanations.

Required subviews:

- Overview;
- Terms;
- Payments;
- Lifecycle;
- State Changes;
- Transactions;
- Raw Data.

### Activity — `/activity`

Must cover recognized Lending and Single Asset Vault transaction types:

- VaultCreate;
- VaultDeposit;
- VaultWithdraw;
- VaultSet;
- VaultClawback;
- VaultDelete;
- LoanBrokerSet;
- LoanBrokerCoverDeposit;
- LoanBrokerCoverWithdraw;
- LoanBrokerCoverClawback;
- LoanBrokerDelete;
- LoanSet;
- LoanPay;
- LoanManage;
- LoanDelete.

Activity shows result, time, ledger, transaction hash, initiating account, affected objects, normalized before-and-after changes, provenance, and bounded export access where supported.

### Transaction detail — `/transactions/:transactionHash`

Must show the transaction, metadata summary, affected nodes, normalized object changes, links to affected entities, provenance, and raw JSON where retained.

### Search — `/search`

Search inputs include:

- Vault ID;
- LoanBroker ID;
- Loan ID;
- transaction hash;
- XRPL account;
- MPT issuance ID;
- asset code or issuer pair.

Search distinguishes no result, invalid identifier, unavailable index, current result, and archived result.

### Account detail — `/accounts/:account`

Must aggregate owned Vaults, managed Brokers, Borrower Loans, protocol transactions, and archived relationships. It must not claim off-chain identity, KYC status, or ownership beyond on-ledger relationships.

### Network Status — `/network-status`

Must show endpoint or server state where publicly safe, server version, complete-ledger range where available, validated ledger, collector cursor, collection lag, amendment state, retry/backoff state where available, snapshot availability, current epoch, reset reason, public-safe error state, and data age.

## Required audit pages

### Lifecycle explorer — `/audit/lifecycle`

Provides protocol-wide recorded Loan lifecycle events with network, epoch, Loan, Broker, Vault, account, asset, ledger, transaction, event type, and provenance context where supported. It must not infer unsupported intermediate events.

### Archived Objects — `/audit/archived`

Lists deleted Vault, LoanBroker, and Loan records and supports type, epoch, relationship, transaction, and classification filters where supported.

Archived detail pages show:

- persistent archived-state explanation;
- final state;
- deletion event and transaction;
- normalized before-and-after or removal representation;
- archive metadata and provenance;
- related entities and source transactions;
- raw archive data where retained.

Unknown deletion reasons remain explicit unknowns.

### Cover & Loss — `/audit/cover-loss`

Shows asset-separated:

- DebtTotal and DebtMaximum history;
- CoverAvailable history;
- cover deposit, withdrawal, and clawback events;
- LossUnrealized history;
- required minimum cover and formula inputs;
- cover surplus or shortfall;
- Broker and Vault context;
- source events and provenance.

It must not show fiat totals, cross-asset aggregation, proprietary risk scores, or unsupported liquidation predictions.

### Devnet Epochs — `/epochs` and `/epochs/:epochId`

Lists current and archived Devnet epochs and permits epoch-scoped browsing without mixing epochs. It shows first and last ledger where known, reset reason and time, current/archive state, and persistent historical context.

## Required documentation and project pages

### API documentation — `/api`

Must document:

- endpoint list;
- query parameters;
- bounded pagination, sorting, and filters;
- network and epoch fields;
- provenance;
- stale and unavailable states;
- response examples clearly labelled as examples;
- JSON, CSV, NDJSON, and activity-feed formats;
- raw-retention boundaries;
- read-only and Devnet-only status.

Initial core endpoints include:

- `GET /api/overview`;
- `GET /api/vaults` and `GET /api/vaults/{vaultId}`;
- `GET /api/loan-brokers` and `GET /api/loan-brokers/{brokerId}`;
- `GET /api/loans` and `GET /api/loans/{loanId}` when M4-4 is complete;
- activity, transaction, epoch, object-history, Loan-lifecycle, search, export, and feed endpoints implemented by M3.

Before an active current-state snapshot or public object-shard binding is available, current entity endpoints return explicit unavailable state and reason rather than inventing current entities.

### Methodology — `/methodology`

Methodology is a separate long-form page, not a subsection compressed into About.

Required sections:

1. scope and principles;
2. data sources;
3. validated-ledger selection;
4. current-state bootstrap;
5. marker resume;
6. incremental ledger collection;
7. AffectedNodes normalization;
8. asset normalization;
9. lifecycle reconstruction;
10. Loan status rules;
11. cover, debt, and loss formulas;
12. deleted-object archive;
13. Devnet epoch handling;
14. provenance categories;
15. unavailable and missing data;
16. idempotency and reconciliation;
17. storage and retention;
18. API and export behavior;
19. known limitations;
20. verification and release process.

The page has stable anchors, a usable table of contents, readable long-form layout, and links to source specifications or code where useful.

### About — `/about`

Must explain:

- what XRPL Lending Monitor is;
- why it exists;
- intended users;
- what it monitors;
- what makes the historical audit layer different;
- Devnet-only initial scope;
- independent and read-only status;
- what the product does not provide;
- repository and Methodology links;
- Contact link.

About must not duplicate the full Methodology.

### Contact — `/contact`

Must present two separate contact paths:

1. a configured Google Form for general or private inquiries;
2. configured GitHub Issues or issue templates for public bugs, data corrections, API issues, documentation issues, and feature requests.

The page warns users not to publish seeds, private keys, secrets, personal data, or non-public security details in GitHub Issues.

Missing external configuration produces an explicit unavailable explanation or omits the action. Placeholder URLs are prohibited.

## Public discoverability and analytics

Public release preparation must provide:

- route-specific titles and descriptions for indexable HTML routes;
- one explicit final public host used for canonical URLs and absolute sitemap URLs;
- `robots.txt` and sitemap behavior that distinguish public HTML discovery from API, status, export, feed, and other machine endpoints;
- Open Graph and social-card metadata that accurately describe the independent, read-only, Devnet scope;
- structured data only where the selected schema accurately matches the public page and evidence boundary;
- an analytics integration hook that is inactive when no measurement ID is configured and never ships a placeholder ID;
- Search Console verification and sitemap submission as an owner-managed external launch task after the final public host is configured.

Canonical, sitemap, analytics, and verification values must not be hard-coded to temporary Worker URLs, placeholder subdomains, fake measurement IDs, or placeholder verification tokens. SEO metadata must not imply investment advice, Mainnet availability, wallet capability, transaction submission, fiat valuation, rankings, ratings, or unsupported completeness.

## Data provenance categories

Every user-facing and API field is one of:

- **Direct** — read directly from a validated ledger object or transaction;
- **Derived** — calculated from direct values using a documented formula;
- **Indexed** — reconstructed from collected historical events;
- **Unavailable** — not available on-ledger, not collected, unsupported, or not shown as fact.

## Allowed derived values

Examples:

- Vault utilization;
- used assets;
- Broker debt utilization;
- required minimum cover;
- cover surplus or shortfall;
- actual cover ratio;
- time until payment due;
- time in grace period;
- time since default eligibility.

Every derived value exposes its formula in documentation and, where practical, in the interface.

## Explicitly excluded data and claims

The product must not invent or infer:

- borrower identity;
- KYC information;
- off-chain credit analysis;
- collateral value;
- LTV;
- credit score;
- proprietary safety score;
- investment recommendation;
- guaranteed yield;
- cross-asset TVL without pricing inputs;
- USD or fiat value without an approved pricing subsystem;
- oracle or DEX pricing not present in an approved contract;
- unsupported operational metrics;
- Mainnet state while operating on Devnet.

## Initial release non-goals

- wallet connection;
- Xaman integration;
- transaction signing or submission;
- Vault deposits or withdrawals;
- borrowing or repayment UI;
- Broker management UI;
- funding, donation, or payment UI;
- price oracle integration;
- fiat-denominated aggregation;
- push notifications;
- user accounts;
- personalized portfolios.

These may only be considered after the read-only monitor is stable and a new specification is approved.

## UI behavior requirements

- dark ledger-observatory visual direction;
- desktop left sidebar;
- mobile app bar, bottom navigation, and More menu;
- persistent network and freshness context on data pages;
- summary-first entity pages;
- raw data last;
- explicit loading, empty, unavailable, stale, partial, error, archived, not-found, and invalid-identifier states;
- accessible keyboard, focus, semantics, contrast, zoom, and long-identifier behavior;
- responsive behavior defined by the UI source-of-truth documents.

Generated mockups are visual references only and never override API or data specifications.

## Release gates

The first public release is not complete until:

1. Current Vault, LoanBroker, and Loan scans fully process markers.
2. A complete bootstrap manifest verifies and only the verified snapshot is active.
3. Collector restarts and retries without duplicate records.
4. Devnet reset handling creates a new epoch without corrupting old data.
5. All required Monitor, Audit, System, and Project pages exist.
6. About, Methodology, Contact, and API documentation are complete and correctly linked.
7. Vault → Broker → Loan relationships are navigable.
8. On-ledger and schedule states are not conflated.
9. XRP, IOU, and MPT are handled correctly and not combined without pricing inputs.
10. Deleted objects remain searchable and have final-state audit pages.
11. Activity displays normalized before-and-after changes.
12. Data provenance is exposed.
13. Loading, empty, unavailable, stale, partial, error, archived, and invalid-route states are tested.
14. Desktop and mobile navigation, responsive behavior, long identifiers, keyboard use, screen readers, contrast, and zoom pass.
15. Runtime, storage, collection, cache, and abuse guardrails are active.
16. Automated tests cover parser, status, asset, epoch, lifecycle, API, UI, and archive behavior.
17. Contact external links are configured or explicitly unavailable; no placeholder URL is public.
18. A manual full-page screenshot audit covers representative desktop and mobile routes with production-shaped data, and identified overflow, clipping, spacing, fixed-navigation overlap, safe-area, long-identifier, and form-layout defects are resolved and re-audited.
19. Route-specific metadata, final-host canonical URLs, robots policy, sitemap, social metadata, and any structured data pass discoverability review; analytics remains disabled unless a real configured measurement ID is supplied.
20. Multi-day Devnet soak, deployment approval, operational runbook, backup/export procedure, and rollback checks pass.
21. Mainnet remains disabled unless separately approved.