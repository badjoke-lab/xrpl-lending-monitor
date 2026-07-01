# Competitor positioning

## Market position

XRPL Lending Monitor is not intended to replace general XRPL explorers or lending frontends.

Its position is:

> A complete baseline XRPL Lending monitor plus an independent historical and operational audit layer.

## Competitor categories

### Official XRPL documentation and developer tools

Strengths:

- authoritative protocol definitions;
- transaction and ledger-object references;
- tutorials and network tooling.

Our role:

- present live and historical protocol activity;
- connect Vault, LoanBroker, Loan, transaction, and lifecycle records;
- preserve deleted objects and Devnet epochs.

Official documentation remains the protocol source, not a product competitor to beat on authority.

### General XRPL explorers

Examples include Bithomp and XRPSCAN.

Strengths:

- broad XRPL coverage;
- account and transaction search;
- mature infrastructure and established users.

We will not compete on:

- all-ledger breadth;
- generic account pages;
- general transaction exploration;
- brand reach.

We differentiate through Lending-specific interpretation, relationships, lifecycle history, cover tracking, deleted-object archives, and provenance.

### XRPL-focused dashboards with Lending sections

A known direct comparator is `xrpldashboard`, which already prepares a Broker/Vault/Loan view and basic counts and totals.

Baseline parity required before release:

- protocol and amendment status;
- complete current Vault, Broker, and Loan counts;
- asset-aware balances;
- Broker debt and Loan counts;
- default-related visibility;
- ordinary monitoring UI.

Differentiators:

- separate on-ledger and schedule-derived state;
- full Loan lifecycle;
- deleted-object search;
- before/after changes;
- first-loss cover history and shortfall calculations;
- complete Vault → Broker → Loan navigation;
- MPT-aware asset resolution;
- Devnet epoch archive;
- provenance and public history API.

### Lending product frontends

Examples may provide deposit, yield, portfolio, or product-specific Vault interfaces.

We will not compete on:

- deposits or borrowing;
- wallet integration;
- customer portfolios;
- product-specific yield marketing.

We remain independent, protocol-wide, and read-only.

## Baseline versus differentiation

### Baseline product requirements

- Overview
- Vault list and detail
- Loan Broker list and detail
- Loan list and detail
- Activity and transaction detail
- Search and account relationships
- Network and amendment status
- asset-separated current totals
- filters, sorting, and pagination

### Differentiated product requirements

- historical lifecycle reconstruction;
- deleted Vault, Broker, and Loan archives;
- accurate default-eligibility versus actual default;
- normalized state changes;
- first-loss cover and loss history;
- Devnet epoch preservation;
- data provenance;
- JSON, CSV, NDJSON, and feed access.

Differentiated features never excuse missing baseline features.

## Accuracy advantage

The product should win on explicit interpretation rules:

- do not classify time-expired Loans as defaulted without an on-ledger default state;
- do not describe the protocol as an on-ledger collateral and liquidation system when those facts are not present;
- do not collapse unlike assets into one TVL;
- do not use a friendly token symbol as canonical identity;
- do not infer borrower identity or credit quality.

## Defensible advantage

The strongest defensible asset is accumulated, normalized history from the earliest collection point:

- complete event chronology;
- object changes;
- deleted final states;
- lifecycle reconstruction;
- Devnet epochs;
- consistent formulas and provenance.

The UI alone is not a moat. Data continuity and correctness are.

## Success criteria

The project succeeds if it becomes the most precise public reference for answering:

- What currently exists in XRPL Lending?
- How are Vaults, Brokers, and Loans related?
- What changed and why?
- Is a Loan actually defaulted, only late, or merely default-eligible?
- What happened to an object after it disappeared from the current ledger?
- How did debt, cover, and unrealized loss evolve?

Traffic leadership over general explorers is not required.

## Stop or reduce-scope criteria

Reassess the project if, after Mainnet activation and an observation period:

- protocol usage remains negligible;
- a mature competitor provides equivalent complete history and audit data;
- free operation is not sustainable;
- reliable historical reconstruction is impossible from available public data.

In that case, preserve the project as a smaller historical registry rather than maintaining an unjustified full dashboard.
