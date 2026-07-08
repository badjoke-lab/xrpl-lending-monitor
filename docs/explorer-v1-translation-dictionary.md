# Explorer v1 translation dictionary

Last updated: 2026-07-08.

## Purpose

This document defines the pre-entry plain-language translation rules for Explorer v1.

The translation layer helps newcomers understand supported protocol facts without changing canonical meaning. It does not replace technical field names, transaction types, result codes, identifiers, provenance, or canonical detail routes.

This document does not start E1-4 implementation. It prepares the translation contract that E1-4 must review against the final API shapes and measured Explorer resource plan.

## General translation rules

1. Plain-language wording supplements canonical evidence.
2. Technical field names remain reachable through detail disclosure or technical routes.
3. On-ledger state and schedule-derived state are never merged.
4. A non-success transaction is described as an attempt, not as a completed state change.
5. Missing, unavailable, unsupported, or uncollected evidence is never translated into zero or success.
6. Current object state does not imply a complete historical timeline.
7. Asset identity and units remain canonical and separate.
8. Dates identify UTC and preserve source semantics.
9. Relationship wording uses observed current evidence and never implies off-chain identity or legal responsibility.
10. Activity subtype wording is used only when the supporting normalized evidence or before/after state makes the subtype explicit.

## Concept dictionary

| Canonical term | Explorer label | Plain-language explanation | Caveat |
|---|---|---|---|
| Vault | Vault | A protocol object that holds and accounts for lending assets. | Do not describe it as a bank account, investment fund, or guaranteed pool. |
| Loan Broker | Loan Broker | A protocol object that connects lending activity to a Vault and manages related lending parameters and debt context. | Do not imply off-chain brokerage, identity, licensing, or credit assessment. |
| Loan | Loan | A protocol object that records borrower obligations, balances, terms, and payment schedule fields. | Do not infer collateral value, LTV, creditworthiness, or borrower identity. |
| Current state | Current state | The latest resolved object state from the verified base plus validated incremental overlay. | Current state is not complete historical activity. |
| Indexed history | Indexed history | Historical evidence reconstructed from the collected validated-ledger observation window. | Missing pre-observation history is not inferred. |
| Lifecycle | Loan lifecycle | Recorded Loan creation, payment, management, impairment, unimpairment, default, and deletion evidence where indexed. | Do not claim complete lifecycle coverage outside the documented observation boundary. |
| Archived | Archived | An object removed from current state but retained in indexed historical evidence. | Archived does not automatically mean failure or default. |
| Direct | Direct | Value read from a validated ledger object or transaction. | Preserve the canonical provenance label. |
| Derived | Derived | Value calculated from approved direct inputs with a documented formula. | Formula or Methodology link must remain available. |
| Indexed | Indexed | Value reconstructed from collected historical evidence. | Indexed does not mean complete before the collection boundary. |
| Unavailable | Unavailable | The value is not available or not supported as a fact in the current evidence. | Never replace with zero. |

## Loan field dictionary

| Canonical field or concept | Explorer label | Plain-language explanation | Display rule |
|---|---|---|---|
| `id` / Loan ID | Loan ID | The canonical identifier of this Loan object. | May be visually shortened; full value remains copyable and accessible. |
| `Borrower` | Borrower account | The XRPL account recorded as the borrower for this Loan. | Do not infer real-world identity. |
| on-ledger status | On-ledger state | The protocol state recorded for the Loan itself. | Keep separate from schedule state. |
| schedule status | Schedule state | A time-based interpretation calculated from current schedule fields and evaluation time. | `default_eligible` must never be worded as confirmed `defaulted`. |
| canonical asset | Asset | The canonical asset associated through the approved Loan -> Broker -> Vault relationship. | Preserve XRP, IOU, and MPT identity; never convert to fiat by default. |
| `PrincipalOutstanding` | Outstanding principal | The remaining principal amount recorded for this Loan. | Show exact asset unit and provenance. |
| `TotalValueOutstanding` | Total value outstanding | The total recorded outstanding value for the Loan according to the protocol object fields. | Do not translate as market value or fiat value. |
| `ManagementFeeOutstanding` | Management fee outstanding | The currently recorded unpaid management fee amount. | Show only when supported and with exact asset context. |
| `PeriodicPayment` | Regular payment amount | The amount recorded for one scheduled periodic payment. | This is not a reconstructed payment history. |
| `PaymentRemaining` | Payments remaining | The number of scheduled payments still remaining. | Do not infer how many payments were historically completed unless indexed evidence supports it. |
| `NextPaymentDueDate` | Next payment due | The next recorded due point for the Loan schedule. | Show UTC. Nullable terminal state must remain explicit. |
| `GracePeriod` | Grace period | Additional schedule time after the due point before default eligibility may apply under the documented schedule calculation. | Do not call this a guaranteed extension or legal grace period. |
| default eligible time | Default eligible at | The calculated time when the schedule may become default eligible based on current fields. | Derived; not a statement that the Loan is defaulted. |
| `LoanBrokerID` | Related Loan Broker | The current Loan Broker relationship recorded for this Loan. | Link only within same network/epoch/current context. |
| related Vault | Related Vault | The Vault reached through the approved current Loan -> Broker -> Vault relationship. | If unresolved or unavailable, say so explicitly. |
| `LoanSequence` | Loan sequence | The protocol sequence value recorded for this Loan. | Technical detail; normally secondary. |
| `Flags` | Flags | The raw protocol flag value for the Loan. | Keep technical; do not invent friendly meaning without approved decoding. |

## Vault field dictionary

| Canonical field or concept | Explorer label | Plain-language explanation | Display rule |
|---|---|---|---|
| `Asset` | Asset | The canonical asset held and accounted for by the Vault. | Preserve canonical identity. |
| `AssetsTotal` | Total assets | The total asset amount recorded by the Vault. | Never combine unlike assets. |
| `AssetsAvailable` | Available assets | The currently recorded amount available according to the Vault object. | Do not label as withdrawable by the current user. |
| `AssetsMaximum` | Maximum assets | The configured maximum asset amount where present. | Missing remains unavailable, not infinite. |
| `LossUnrealized` | Unrealized loss | The unrealized loss amount recorded by the Vault field. | Do not convert to risk grade or fiat value. |
| `WithdrawalPolicy` | Withdrawal policy | The protocol policy value governing Vault withdrawal behavior. | Use approved decoding only; otherwise retain technical value. |
| `ShareMPTID` | Share MPT ID | The canonical MPT issuance identifier associated with Vault shares where present. | Full identifier remains accessible. |
| `DomainID` | Domain ID | The protocol domain identifier recorded by the Vault where present. | Do not infer ownership or off-chain identity beyond approved semantics. |

## Loan Broker field dictionary

| Canonical field or concept | Explorer label | Plain-language explanation | Display rule |
|---|---|---|---|
| `VaultID` | Related Vault | The Vault associated with this Loan Broker. | Same-context relationship only. |
| `DebtTotal` | Total debt | The total debt amount recorded for the Loan Broker. | Asset-separated exact value only. |
| `DebtMaximum` | Maximum debt | The configured debt maximum where present. | Missing remains unavailable. |
| debt utilization | Debt utilization | A documented derived ratio comparing total debt with maximum debt when both inputs are supported. | Derived formula/provenance remains available. |
| `CoverAvailable` | Cover available | The cover amount currently recorded for the Loan Broker. | Exact asset-separated value. |
| required minimum cover | Required minimum cover | A derived amount calculated from approved cover-rate inputs and debt context. | Show formula/provenance; do not call it a safety score. |
| cover surplus/shortfall | Cover surplus / shortfall | The difference between available cover and required minimum cover under the approved formula. | Derived, asset-separated, not an investment conclusion. |
| `CoverRateMinimum` | Minimum cover rate | The configured minimum cover-rate value recorded by the Broker. | Preserve protocol units and documented formatting. |
| `CoverRateLiquidation` | Liquidation cover rate | The configured liquidation-related cover-rate value recorded by the Broker. | Do not turn this into a predicted liquidation probability. |
| `ManagementFeeRate` | Management fee rate | The management-fee rate value recorded by the Broker. | Preserve protocol units and technical detail access. |
| `OwnerCount` | Owner count | The protocol owner-count field recorded for the Broker context. | Do not automatically translate this as number of Loans without a documented reconciliation rule. |

## Activity translation framework

Every translated Activity item preserves:

- plain-language summary;
- canonical transaction type;
- result code or result classification;
- ledger index;
- transaction hash;
- affected object links where available;
- provenance.

### Success versus non-success wording

Successful pattern:

```text
A payment was recorded for a Loan
LoanPay · tesSUCCESS
```

Non-success pattern:

```text
A Loan payment was attempted but did not succeed
LoanPay · <result code>
```

A non-success transaction must not use wording such as `payment completed`, `Loan defaulted`, `Vault deleted`, or any other completed state change unless separate canonical evidence proves that state.

## Activity transaction dictionary

| Canonical transaction type / supported context | Success translation | Non-success translation | Notes |
|---|---|---|---|
| `VaultCreate` | A Vault was created | Vault creation was attempted but did not succeed | Link Vault when available. |
| `VaultDeposit` | Assets were deposited into a Vault | A Vault deposit was attempted but did not succeed | Preserve canonical asset and exact amount only when supported. |
| `VaultWithdraw` | Assets were withdrawn from a Vault | A Vault withdrawal was attempted but did not succeed | Do not imply user ownership of the withdrawn assets. |
| `VaultSet` | Vault settings were updated | A Vault settings update was attempted but did not succeed | Changed fields may be shown only from normalized evidence. |
| `VaultClawback` | A Vault clawback transaction succeeded | A Vault clawback was attempted but did not succeed | Keep canonical transaction type visible; avoid speculative interpretation. |
| `VaultDelete` | A Vault was removed from current state | Vault deletion was attempted but did not succeed | Archived historical context remains separate. |
| `LoanBrokerSet` | Loan Broker settings were created or updated | A Loan Broker settings change was attempted but did not succeed | Use more specific create/update wording only when node evidence supports it. |
| `LoanBrokerCoverDeposit` | Cover was deposited for a Loan Broker | A cover deposit was attempted but did not succeed | Preserve exact asset context when supported. |
| `LoanBrokerCoverWithdraw` | Cover was withdrawn from a Loan Broker | A cover withdrawal was attempted but did not succeed | Avoid safety conclusions. |
| `LoanBrokerCoverClawback` | A Loan Broker cover clawback transaction succeeded | A cover clawback was attempted but did not succeed | Keep technical context available. |
| `LoanBrokerDelete` | A Loan Broker was removed from current state | Loan Broker deletion was attempted but did not succeed | Archived context remains separate. |
| `LoanSet` | A Loan was created or established | Loan creation was attempted but did not succeed | Use exact wording approved by final normalized event semantics. |
| `LoanPay` generic | A payment was recorded for a Loan | A Loan payment was attempted but did not succeed | Do not infer regular/full/overpayment subtype without supporting evidence. |
| `LoanPay` regular context | A regular payment was recorded for a Loan | A regular Loan payment was attempted but did not succeed | Use only when approved normalized evidence identifies the subtype. |
| `LoanPay` full-payment context | The recorded payment completed the remaining Loan payment obligation | A full Loan payment was attempted but did not succeed | Use only when resulting canonical state supports this interpretation. |
| `LoanPay` overpayment context | An overpayment was recorded for a Loan | A Loan overpayment was attempted but did not succeed | Use only when approved normalized evidence identifies overpayment. |
| `LoanManage` impaired transition | The Loan was marked as impaired | A Loan impairment change was attempted but did not succeed | Show status before/after when available. |
| `LoanManage` unimpaired transition | The Loan impairment state was removed | Removal of the Loan impairment state was attempted but did not succeed | Use only when status transition evidence is explicit. |
| `LoanManage` default transition | The Loan was marked as defaulted | A Loan default-state change was attempted but did not succeed | Do not confuse with schedule `default_eligible`. |
| `LoanDelete` | A Loan was removed from current state | Loan deletion was attempted but did not succeed | Archived historical evidence remains available where indexed. |

## Translation fallback rule

When a transaction or field cannot be translated safely, Explorer uses a conservative fallback:

```text
Protocol activity recorded
<CanonicalTransactionType> · <result code>
```

or:

```text
Technical value
<CanonicalFieldName>: <exact value>
```

A vague but accurate fallback is preferable to an invented friendly explanation.

## Review requirements before E1-4

Before E1-4 implementation:

- compare this dictionary with the final API response fields and normalized event semantics;
- remove or narrow any translation that is not supported by actual evidence;
- confirm success/non-success branching from canonical result classification;
- confirm subtype translation conditions for `LoanPay` and `LoanManage`;
- verify accessible full identifiers and canonical evidence links;
- verify translation does not change asset, status, time, result, or provenance meaning.
