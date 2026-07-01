# Competitor positioning

## Market position

XRPL Lending Monitor is an independent, read-only monitor and historical audit layer for the XRPL Lending Protocol. It complements official protocol documentation, general XRPL explorers, and product-specific lending frontends rather than replacing them.

## Baseline product requirements

- protocol and amendment status;
- Overview, Vault, Loan Broker, Loan, activity, search, and network pages;
- complete current object counts;
- asset-aware balances and totals;
- filters, sorting, and pagination;
- clear default-related visibility.

Baseline completeness is required before differentiated audit features are treated as product strengths.

## Differentiation

The product differentiates through:

- separate on-ledger and schedule-derived state;
- full Loan lifecycle reconstruction;
- deleted-object search and final-state preservation;
- normalized before-and-after changes;
- first-loss cover, debt, and loss history;
- complete Vault → Broker → Loan navigation;
- MPT-aware asset resolution;
- Devnet epoch preservation;
- explicit provenance and public history access.

## Accuracy principles

- Do not classify a time-expired Loan as defaulted without on-ledger evidence.
- Do not infer collateral value, LTV, borrower identity, or credit quality.
- Do not combine unlike assets into a synthetic TVL without a documented pricing layer.
- Do not use a friendly symbol as canonical asset identity.
- Expose formulas and provenance for derived values.

## Defensible advantage

The strongest long-term asset is accumulated, normalized history: event chronology, object changes, deleted final states, lifecycle reconstruction, Devnet epochs, and consistent interpretation rules.

The UI alone is not the differentiator. Data continuity and correctness are.

## Success criteria

The product should become a precise public reference for answering:

- What currently exists in XRPL Lending?
- How are Vaults, Brokers, and Loans related?
- What changed and why?
- Is a Loan defaulted, late, or only default-eligible?
- What happened after an object disappeared from the current ledger?
- How did debt, cover, and unrealized loss evolve?
