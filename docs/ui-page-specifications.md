# UI page specifications

## Purpose

This document defines the responsibility, required content, API dependency, unavailable behavior, navigation, and milestone assignment for every public page. It complements `product-spec.md`; it does not weaken any product, data, status, asset, provenance, or release requirement.

## Common requirements for every data page

Every monitoring or audit page must:

- show Devnet, epoch, validated-ledger, freshness, and collector context where available;
- distinguish current, historical, archived, stale, empty, unavailable, partial, and error states;
- preserve XRP, IOU, and MPT identity without unsupported aggregation;
- keep on-ledger status separate from schedule status;
- identify Direct, Derived, Indexed, and Unavailable data;
- provide shareable routes for filters, pagination, selected entities, and meaningful subviews where practical;
- use only approved read-only API data;
- avoid wallet, signing, deposit, borrowing, repayment, or administration affordances.

## Overview — `/`

### Purpose

Provide a fast, trustworthy summary of protocol availability and current monitoring state, then route users to detailed pages.

### Required content

- Devnet and epoch context;
- amendment status;
- latest validated ledger and age;
- last processed ledger, collector status, lag, and last success;
- current Vault, Loan Broker, Loan, and current-object counts when an active snapshot exists;
- explicit unavailable explanation before snapshot activation;
- recent protocol activity preview;
- stale, collector-error, and reset notices;
- provenance legend;
- links to Vaults, Loan Brokers, Loans, Activity, Network Status, and Methodology.

### Prohibited content

- cross-asset totals;
- USD or fiat estimates;
- unsupported charts;
- fabricated zeros for unavailable counts;
- implied investment or safety conclusions.

### API dependencies

`/api/status`, `/api/overview`, and bounded `/api/activity`.

### Milestone

M4-1.

## Network Status — `/network-status`

### Purpose

Expose operational state and evidence without requiring raw API inspection.

### Required content

- endpoint or server state where publicly safe;
- server version and complete-ledger range where available;
- validated ledger and ledger age;
- collector cursor and lag;
- last attempt and last success;
- consecutive failures and public-safe current error;
- amendment enabled and supported states;
- epoch and reset reason;
- active snapshot identity and availability;
- stale thresholds and explanations;
- link to status API and Methodology.

### Milestone

M4-1.

## Vault list — `/vaults`

### Purpose

Browse current and discoverable archived Vaults.

### Required behavior

- bounded search, pagination, sorting, and filters;
- filters for asset, public/private state, loss presence, connected Broker presence, epoch, and archive context where supported;
- columns defined by `product-spec.md`;
- explicit active-snapshot unavailable state;
- route to Vault detail and archive record.

### Milestone

M4-2.

## Vault detail — `/vaults/:vaultId`

### Purpose

Explain one Vault’s current state, relationships, activity, history, and final archive context.

### Required sections

- summary and identity;
- current fields and flags;
- asset and Share MPT information;
- utilization and used assets with formula provenance;
- connected Loan Brokers and Loans;
- Deposit, Withdraw, Set, Clawback, and Delete activity;
- balance, availability, and loss history;
- archive banner and final-state link when deleted;
- raw data last.

### Milestone

M4-2, with differentiated historical refinements in M5 where needed.

## Loan Broker list — `/loan-brokers`

### Purpose

Compare Broker debt, capacity, cover, relationships, and factual operational states.

### Required behavior

- bounded search, sorting, pagination, and filters;
- asset-separated values;
- debt utilization;
- required minimum cover and cover surplus or shortfall with formula provenance;
- active, impaired, defaulted, and archived context without proprietary scoring.

### Milestone

M4-3.

## Loan Broker detail — `/loan-brokers/:brokerId`

### Required sections

- owner, pseudo-account, status, and provenance;
- related Vault;
- DebtTotal, DebtMaximum, debt utilization;
- CoverAvailable, configured rates, required cover, surplus or shortfall;
- Loan book;
- CoverDeposit, CoverWithdraw, CoverClawback, Set, and Delete activity;
- debt and cover history;
- archived final state where applicable;
- raw data last.

### Milestone

M4-3, with deeper audit history in M5.

## Loan list — `/loans`

### Purpose

Browse current and archived Loans without conflating protocol and schedule state.

### Required behavior

- bounded search, sorting, pagination, and filters by network, epoch, asset, Vault, Broker, Borrower, on-ledger state, schedule state, and deleted state;
- separate on-ledger and schedule columns;
- exact asset units;
- clear due and grace timestamps;
- archive lookup and relationship links.

### Milestone

M4-4.

## Loan detail — `/loans/:loanId`

### Required tabs

- Overview;
- Terms;
- Payments;
- Lifecycle;
- State Changes;
- Transactions;
- Raw Data.

### Overview requirements

- Borrower, Broker, Vault, and asset;
- current balances;
- on-ledger and schedule states shown separately;
- next payment due and grace end;
- last update, ledger, epoch, and provenance;
- related-entity links.

### Historical requirements

- full lifecycle ordering;
- payment history;
- impair, unimpair, default, and delete events;
- normalized before/after changes;
- source transactions;
- final state after deletion.

### Milestone

Overview, Terms, and core Payments in M4-4. Full lifecycle, state-change, archive, and raw audit integration in M5-1 and M5-2.

## Activity — `/activity`

### Purpose

Browse recognized Lending and Single Asset Vault transactions and normalized changes.

### Required behavior

- transaction-type, result, object-type, account, epoch, provenance, and time filters where API-supported;
- time, ledger, type, result, initiating account, affected objects, normalized change summary, provenance, and hash;
- bounded pagination and export links;
- selected-row or linked transaction detail;
- no fabricated activity-volume chart.

### Milestone

M4-5.

## Transaction detail — `/transactions/:transactionHash`

### Required content

- transaction summary;
- result, fee, sequence, time, ledger, epoch, and source;
- affected nodes;
- normalized object changes;
- related entities;
- retained raw transaction and metadata only where available and allowed;
- provenance and unavailable explanations.

### Milestone

M4-5.

## Search — `/search`

### Search targets

- Vault ID;
- Loan Broker ID;
- Loan ID;
- transaction hash;
- XRPL account;
- MPT issuance ID;
- asset code or issuer pair.

### Required behavior

- validate identifiers before queries;
- group results by type;
- show current versus archived context;
- preserve network and epoch;
- explain no-result versus unavailable states.

### Milestone

M4-5.

## Account detail — `/accounts/:account`

### Required content

- owned Vaults;
- managed Loan Brokers;
- Borrower Loans;
- protocol transactions;
- archived relationships;
- no off-chain identity or KYC claims.

### Milestone

M4-5.

## Lifecycle explorer — `/audit/lifecycle`

### Purpose

Provide a protocol-wide lifecycle event explorer distinct from a single Loan’s timeline.

### Required behavior

- event filters, epoch, Loan, Broker, Vault, account, and asset context where supported;
- ledger and transaction ordering;
- event provenance;
- links to Loan, transaction, and archive details;
- no unsupported inference between recorded events.

### Milestone

M5-1.

## Archived Objects — `/audit/archived`

### Required behavior

- browse deleted Vault, Loan Broker, and Loan records;
- filter by type, epoch, related identifier, deletion transaction, and classification where supported;
- distinguish unknown deletion classification from confirmed reasons;
- route to archived detail.

### Milestone

M5-2.

## Archived object detail — `/audit/archived/:objectType/:objectId`

### Required content

- persistent archive banner;
- final state;
- deletion event, ledger, time, and transaction;
- normalized before/after or removal representation;
- related entities and source transactions;
- archive metadata and provenance;
- retained raw archive data where available;
- link back to current entity when one exists in another epoch or context.

### Milestone

M5-2.

## Cover & Loss — `/audit/cover-loss`

### Required content

- asset-separated DebtTotal, DebtMaximum, CoverAvailable, and LossUnrealized histories;
- required minimum cover formula and inputs;
- cover surplus or shortfall;
- Broker and Vault context;
- source events and provenance;
- explicit missing-data behavior.

### Prohibited content

- cross-asset aggregation;
- fiat totals;
- proprietary risk scores;
- unsupported liquidation predictions.

### Milestone

M5-3.

## Devnet Epochs — `/epochs` and `/epochs/:epochId`

### Required content

- current and archived epochs;
- first and last ledger where known;
- reset reason and timestamps;
- epoch-scoped objects, activity, and archives;
- persistent warning against mixing epochs;
- links back to current context.

### Milestone

M5-4.

## API documentation — `/api`

### Required content

- endpoint list;
- parameters, limits, sorting, pagination, network, and epoch semantics;
- response examples using clearly labeled examples;
- provenance and unavailable states;
- export and feed formats;
- raw-retention boundaries;
- read-only and Devnet-only status.

### Milestone

M4-6, then maintained with API changes.

## Methodology — `/methodology`

### Required sections

1. scope and principles;
2. data sources;
3. validated-ledger selection;
4. current-state bootstrap;
5. marker resume;
6. incremental collection;
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
18. API and exports;
19. known limitations;
20. verification and release process.

The page supports stable anchors, an on-page table of contents, readable long-form layout, and links to source code or specifications where useful.

### Milestone

M4-6, with evidence updates through M6.

## About — `/about`

### Required sections

- what XRPL Lending Monitor is;
- why it exists;
- intended users;
- what it monitors;
- what makes its audit layer different;
- Devnet-only initial scope;
- independent and read-only status;
- explicit non-goals;
- repository and Methodology links;
- optional Support section;
- Contact link.

### Milestone

M4-6.

## Contact — `/contact`

### Required content

Two clearly separated options:

1. General or private inquiry through a configured Google Form.
2. Public technical issue, data correction, documentation issue, or feature request through GitHub Issues.

The page must warn against posting seeds, private keys, personal data, secrets, or non-public security details in public issues. Missing external configuration must produce an unavailable explanation rather than a placeholder link.

### Milestone

M4-6.

## Support section — `/about#support`

### Status

Optional and disabled by default.

### Required approval before enablement

- XRPL address;
- payment network;
- accepted asset or assets;
- destination-tag requirement;
- disclosure text;
- QR payload;
- operational ownership.

### Required content when enabled

- voluntary support statement;
- no entitlement, service level, influence, investment return, or listing benefit;
- clear separation between Devnet monitoring and Mainnet payment network;
- copyable address and QR code;
- exact accepted-asset and destination-tag instructions;
- Contact link for payment mistakes without promising recovery.

### Placement

- About section is the canonical destination;
- small sidebar, mobile More menu, footer, and Contact links may point to it;
- no support prompt appears inside data tables, metric cards, warnings, or entity details.

### Milestone

M4-6 only if approval is complete. Otherwise the route anchor may remain reserved and hidden.

## Not found and unavailable pages

M4-1 establishes shared handling for:

- route not found;
- invalid identifier;
- unavailable API;
- missing active snapshot;
- stale collector;
- archived-only entity;
- unsupported data field;
- partial panel failure.

## Release completeness

A route is not complete merely because a shell exists. It must have:

- approved information architecture;
- all required data states;
- responsive behavior;
- keyboard and screen-reader support;
- focused tests;
- API-contract alignment;
- no invented values;
- implementation-status evidence.
