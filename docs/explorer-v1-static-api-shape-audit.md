# Explorer v1 static API shape audit

Last updated: 2026-07-08.

## Purpose

This document records a static repository audit of the current public API and UI response shapes relevant to Explorer v1 pre-entry design.

It is not production resource evidence and does not finalize E1-1 query choices. Its purpose is to remove avoidable ambiguity before measured E1-1 review.

## Audit boundary

Reviewed implementation surfaces:

- `src/ui/types/api.ts`;
- `src/worker/index.ts`;
- `src/worker/routes/current-loan-brokers.ts`;
- `src/worker/routes/current-loans.ts`;
- `src/worker/serializers/current-loans.ts`;
- `src/worker/serializers/history-api.ts`.

The audit asks:

1. which Explorer sections can already be composed from existing bounded response shapes;
2. whether relationship seed data requires per-row detail requests;
3. which list routes currently support relationship-specific filtering;
4. whether Activity list rows expose affected-object links directly;
5. where lazy detail or additional measured composition work may still be required.

## Confirmed current response capabilities

### Overview

`OverviewResponse` currently provides:

- network;
- epoch summary;
- active snapshot summary;
- collector status;
- latest validated ledger;
- last processed ledger;
- last success time;
- Vault count;
- Loan Broker count;
- Loan count;
- current object count;
- count and freshness provenance;
- unavailable reasons.

Implication:

The planned current snapshot cards can source their primary counts and freshness context from existing overview/status contracts without inventing an Explorer-specific aggregate layer.

### Vault collection

`VaultCollectionResponse` items currently expose:

- Vault ID;
- owner/account fields;
- canonical asset;
- total, available, and maximum assets;
- unrealized loss;
- Share MPT ID;
- Domain ID;
- withdrawal policy;
- flags and previous ledger/transaction evidence;
- derived used-assets and utilization values with provenance.

Current Vault list route supports:

- bounded `limit`;
- cursor pagination;
- `id_asc` / `id_desc` sort;
- bounded text query;
- `has_loss` filter.

It does not currently expose a direct relationship-specific Broker or Loan filter in the route shape reviewed here.

### Loan Broker collection

`LoanBrokerCollectionResponse` items currently expose:

- Broker ID;
- `vault_id`;
- owner/account fields;
- canonical asset;
- debt and cover values;
- configured rates;
- `related_vault` summary;
- derived debt utilization, required minimum cover, cover surplus, and cover ratio with provenance.

Current Loan Broker list route supports:

- bounded `limit`;
- cursor pagination;
- `id_asc` / `id_desc` sort;
- bounded text query.

The route does not currently expose a dedicated `vault_id` relationship filter.

### Loan collection

`LoanCollectionResponse` items currently expose the same serialized Loan summary shape used for current Loan presentation, including:

- Loan ID;
- `loan_broker_id`;
- borrower account;
- canonical asset resolved through current relationships;
- fees and rates;
- schedule dates and intervals;
- payments remaining;
- principal outstanding;
- total value outstanding;
- management fee outstanding;
- periodic payment;
- on-ledger state;
- schedule state;
- schedule-source fields;
- related Loan Broker summary;
- related Vault summary;
- provenance for object, asset, relationships, on-ledger state, and schedule state.

The list serializer includes:

```text
Loan
  -> related_loan_broker.id
  -> related_loan_broker.vault_id
  -> related_vault.id
  -> related_vault.asset
```

for every returned row.

Current Loan list route supports:

- bounded `limit`;
- cursor pagination;
- `id_asc` / `id_desc` sort;
- bounded text query;
- `on_ledger_status` filter;
- `schedule_status` filter.

It does not currently expose dedicated `vault_id` or `loan_broker_id` relationship filters.

## Relationship seed implication

The current Loan collection shape makes the following pre-entry candidate practical:

### Model C — bounded Loan-list-derived relationship seed

```text
one bounded Loan list response
  -> group returned rows by related_vault.id
  -> group each Vault bucket by related_loan_broker.id
  -> render bounded Vault -> Broker -> Loan sample from returned rows
  -> lazy exact detail only after user selection when needed
```

Potential advantages:

- one bounded relationship-seed request;
- no per-row detail fan-out;
- same response already contains major Selected Loan summary fields;
- same response carries direct relationship provenance and current snapshot context;
- client-side grouping can build one bounded visual sample without additional D1 reads by itself.

Important limitations:

- the returned Loan page is not complete protocol topology;
- list ordering may bias which Vault/Broker groups appear in a small sample;
- Vaults or Brokers with no returned Loans will not appear in a Loan-derived sample;
- current Loan route does not expose dedicated Vault/Broker relationship filters;
- the cost of the representative Loan list query must still be measured by the M6 resource harness;
- response bytes and relationship-shard reads must be measured;
- sample-selection rules must be deterministic and clearly labelled as bounded.

Therefore Model C is a strong E1-1 candidate, not an approved final query plan.

## Selected Loan implication

Because Loan collection rows already include:

- separate on-ledger and schedule states;
- canonical asset;
- principal outstanding;
- total value outstanding;
- periodic payment;
- payments remaining;
- next payment due;
- grace period;
- related Broker;
- related Vault;
- provenance;

Explorer may be able to show the initial Selected Loan panel directly from the bounded Loan seed response without an immediate exact detail request.

An exact Loan detail request remains appropriate when:

- raw data is requested;
- additional fields not present in the selected list response are required;
- exact detail freshness/revalidation is intentionally part of the interaction contract;
- canonical technical navigation occurs.

E1-1 must measure whether avoiding the immediate detail request materially reduces cost while preserving the intended user experience and freshness semantics.

## Activity list limitation

The current Activity list serializer returns canonical protocol event metadata including:

- transaction hash;
- epoch ID;
- ledger index;
- event index;
- close time;
- transaction type;
- result code;
- payload-retained state;
- retained source/metadata payload fields where present in the serialized API;
- creation time;
- indexed provenance.

The current Activity list row shape does not directly provide normalized affected-object links.

Implications:

- Explorer can translate transaction type and result safely from the bounded Activity list;
- the page can link to canonical transaction detail by hash;
- Explorer must not promise affected-object links directly from the Activity list unless another approved bounded composition or lazy detail path provides them;
- page-load transaction-detail N+1 requests are prohibited;
- if affected-object preview is considered valuable, E1-1 must measure a bounded composition option or keep object relationships behind transaction-detail navigation/lazy interaction.

## Current list filtering limitation

The reviewed list routes do not expose dedicated relationship filters:

- Vault list: no Broker/Loan relationship filter;
- Loan Broker list: no `vault_id` filter;
- Loan list: no `vault_id` or `loan_broker_id` filter.

Existing generic `q` parameters must not be assumed to be equivalent to relationship-specific filtering without repository evidence proving exact semantics.

Implications:

- Model B in `explorer-v1-relationship-contract.md` cannot assume direct Vault -> Brokers -> Loans server filtering from current list routes;
- relationship expansion may require a current approved relationship/search contract, a measured bounded composition endpoint, or client-side use of already returned seed data;
- E1-1 must inspect actual repository reader/search semantics before choosing an expansion path.

## Pre-entry candidate ranking

Based on static shape only, before resource measurement:

1. **Model C — bounded Loan-list-derived seed**: strongest candidate for initial relationship sample because the current Loan row already carries Loan -> Broker -> Vault relationships and readable Loan fields.
2. **Model A — bounded sample anchor using existing mixed contracts**: possible, but may require more composition work or requests.
3. **Model B — user-selected Vault followed by direct relationship-filtered lists**: not currently supported by the reviewed list-route filter shapes as a simple assumption; requires a different approved relationship path or measured API work.

This ranking is provisional. M6 resource evidence and E1-1 contract review control the final decision.

## E1-1 decisions still required

- exact Loan seed limit;
- sort order or deterministic sample selection rule;
- whether the sample should intentionally seek relationship variety;
- whether current list ordering creates misleading concentration;
- response-size budget;
- D1/base-read cost of the chosen Loan list shape;
- whether Selected Loan can reuse list-row data without exact detail;
- whether relationship expansion remains client-side within seed data or requires an approved bounded backend path;
- whether Activity affected-object preview justifies any additional bounded composition;
- exact request budget and interaction delta budget.

## Conclusion

Current API shapes are already favorable to the approved A+C Explorer direction.

The strongest static finding is that one bounded Loan collection response can potentially provide:

- the relationship sample seed;
- Vault/Broker/Loan grouping inputs;
- one initial Selected Loan summary;
- separate Loan states;
- canonical asset context;
- relationship provenance.

This may allow Explorer v1 to create a visually rich relationship section with limited initial request fan-out. That conclusion remains provisional until M6 resource measurements and E1-1 contract review confirm the query shape and bounds.
