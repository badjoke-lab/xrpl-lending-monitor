# Product specification

## Product definition

XRPL Lending Monitor is a read-only, independent monitor and historical audit layer for the XRPL Lending Protocol.

It must provide the normal information expected from a lending monitor—protocol overview, Vaults, Loan Brokers, Loans, activity, search, and network health—then extend that baseline with complete lifecycle reconstruction, deleted-object archives, state-transition history, first-loss cover tracking, provenance, and Devnet epoch preservation.

The product is not a wallet, lending frontend, broker service, investment product, credit-rating system, or substitute for the XRPL protocol specification.

## Primary users

### General observers

Need to understand current protocol activity without reading raw ledger objects.

### Depositors and market participants

Need to inspect Vault balances, available assets, Broker debt, first-loss cover, Loan schedules, and material changes. The product does not advise whether to deposit or lend.

### Broker operators and developers

Need exact object fields, transaction history, before/after changes, network health, and API access.

### Researchers and auditors

Need historical state, deleted objects, Devnet epochs, lifecycle reconstruction, and explicit data provenance.

## Product principles

1. **Baseline completeness first.** Differentiators do not replace normal monitoring pages.
2. **Facts before scores.** Show protocol facts and transparent calculations, not proprietary risk grades.
3. **Current state and history are separate.** Current ledger objects and indexed historical records must not be confused.
4. **On-ledger status and schedule status are separate.** A Loan can be default-eligible without being defaulted.
5. **Assets remain distinct.** XRP, IOU, and MPT quantities are not added together without a documented pricing layer.
6. **Every value has provenance.** Direct, derived, indexed, or unavailable.
7. **Deleted does not mean forgotten.** Deleted Vault, LoanBroker, and Loan records remain searchable.
8. **Network context is always visible.** Network, epoch, validated ledger, and synchronization time accompany data.
9. **Read-only by design.** No signing or transaction submission in the initial product.
10. **Bounded and measurable resource use is a release constraint.** Collection and storage must remain controlled and observable.

## Initial network scope

### Included

- XRPL Lending Devnet
- Archived Devnet epochs created after collection begins

### Prepared but disabled

- XRPL Mainnet

Mainnet collection may begin only after both required amendments are verified as active and an approved starting-ledger plan is recorded.

## Required pages

### 1. Overview

Must show:

- selected network and epoch;
- amendment status;
- latest validated ledger and age;
- last successful collector run and lag;
- total current Vault, LoanBroker, and Loan counts;
- Loan counts by on-ledger and schedule state;
- asset-separated Vault totals, available assets, debt, and cover;
- recent protocol activity;
- collection errors, stale-data warnings, and Devnet reset notices.

A cross-asset total is prohibited without a documented pricing subsystem.

### 2. Vault list

Must support search, pagination, sorting, and filtering by asset, public/private state, loss presence, and connected Broker presence.

Core columns:

- Vault ID;
- asset;
- owner;
- public/private flags;
- AssetsTotal;
- AssetsAvailable;
- AssetsMaximum;
- utilization;
- LossUnrealized;
- connected Broker count;
- active Loan count;
- last ledger and update time.

### 3. Vault detail

Must show:

- all current Vault fields suitable for users;
- Share MPT and Domain information;
- calculated used assets and utilization;
- connected Brokers and Loans;
- Deposit, Withdraw, Set, Clawback, and Delete activity;
- historical balance, availability, and loss changes;
- final state and deletion event when archived.

### 4. Loan Broker list

Core columns:

- LoanBroker ID;
- owner and pseudo-account;
- connected Vault and asset;
- active Loan count;
- DebtTotal and DebtMaximum;
- debt utilization;
- CoverAvailable;
- configured cover rates;
- calculated required minimum cover;
- calculated cover surplus or shortfall;
- ManagementFeeRate;
- impaired and defaulted Loan counts;
- last update.

### 5. Loan Broker detail

Must show:

- current Broker fields;
- related Vault;
- full Loan book;
- DebtTotal and cover history;
- CoverDeposit, CoverWithdraw, CoverClawback, Set, and Delete activity;
- current cover surplus or shortfall;
- archived final state if deleted.

### 6. Loan list

Must support search, sorting, pagination, and filtering by network, epoch, asset, Vault, Broker, Borrower, on-ledger state, schedule state, and deleted state.

Core columns:

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
- last payment and last update.

### 7. Loan detail

Must show:

- terms and all relevant rate and fee fields;
- current balances and payment schedule;
- on-ledger state;
- schedule-derived state;
- full lifecycle timeline;
- payment history;
- impair, unimpair, default, and delete events;
- before/after field changes;
- related Broker and Vault;
- raw identifiers and source transactions;
- final state after deletion.

Required tabs:

- Overview
- Terms
- Payments
- Lifecycle
- State changes
- Transactions
- Raw data

### 8. Activity

Must cover all recognized Lending and Single Asset Vault transaction types:

- VaultCreate
- VaultDeposit
- VaultWithdraw
- VaultSet
- VaultClawback
- VaultDelete
- LoanBrokerSet
- LoanBrokerCoverDeposit
- LoanBrokerCoverWithdraw
- LoanBrokerCoverClawback
- LoanBrokerDelete
- LoanSet
- LoanPay
- LoanManage
- LoanDelete

Activity must show result, time, ledger, transaction hash, initiating account, affected objects, and normalized before/after changes.

### 9. Transaction detail

Must show the transaction, metadata summary, affected nodes, normalized object changes, links to affected entities, and raw JSON where retained.

### 10. Search and account detail

Search inputs:

- Vault ID
- LoanBroker ID
- Loan ID
- transaction hash
- XRPL account
- MPT issuance ID
- asset code or issuer pair

Account detail must aggregate owned Vaults, managed Brokers, Borrower Loans, protocol transactions, and archived relationships.

### 11. Network status

Must show endpoint status, server version, validated ledger, collector cursor, collection lag, amendment state, rate-limit/backoff state, database health, and current epoch.

### 12. Devnet epochs

Must list current and archived Devnet epochs and allow users to browse objects and activity without mixing epochs.

### 13. API and data documentation

Must document field provenance, formulas, pagination, network and epoch fields, exported formats, and unavailable data.

## Data provenance categories

Every user-facing field and API field is one of:

- **direct** — read directly from a validated ledger object or transaction;
- **derived** — calculated from direct values using a documented formula;
- **indexed** — reconstructed from collected historical events;
- **unavailable** — not available on-ledger and not shown as fact.

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

Every derived value must expose its formula in documentation and, where practical, in the interface.

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
- cross-asset TVL without pricing inputs.

## Initial release non-goals

- Wallet connection
- Xaman integration
- Transaction signing or submission
- Vault deposits or withdrawals
- Borrowing or repayment UI
- Broker management UI
- Price oracle integration
- Fiat-denominated aggregation
- Push notifications
- User accounts
- Personalized portfolios

These may only be considered after the read-only monitor is stable and a new specification is approved.

## Release gates

The first public release is not complete until:

1. Current Vault, LoanBroker, and Loan scans fully process markers.
2. Collector restarts and retries without duplicate records.
3. Devnet reset handling creates a new epoch without corrupting old data.
4. All required baseline pages exist.
5. Vault → Broker → Loan relationships are navigable.
6. On-ledger and schedule states are not conflated.
7. XRP, IOU, and MPT are handled correctly.
8. Deleted objects remain searchable.
9. Activity displays normalized before/after changes.
10. Data provenance is exposed.
11. Runtime, storage, and collection guardrails are active.
12. Automated tests cover parser, status, asset, epoch, and lifecycle behavior.
