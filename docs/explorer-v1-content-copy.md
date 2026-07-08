# Explorer v1 content copy baseline

Last updated: 2026-07-08.

## Purpose

This document defines the approved baseline copy for static and templated Explorer v1 UI text.

It prepares later E1 implementation but does not start E1 work. Dynamic values, request plans, relationship limits, and final endpoint choices remain subject to the Explorer start gate, M6 evidence, and E1-1 review.

The site language is English. Copy should be understandable to newcomers without replacing canonical terminology or technical evidence.

## Copy principles

1. Explain first, then show evidence.
2. Keep sentences short and factual.
3. Use `Vault`, `Loan Broker`, and `Loan` consistently.
4. Do not use marketing language such as `best`, `safe`, `high yield`, `healthy`, `low risk`, or `opportunity` unless the term is part of a documented technical status contract.
5. Do not imply fiat value, cross-asset comparability, collateral health, creditworthiness, legal identity, or investment quality.
6. Use `observed`, `recorded`, `current`, `indexed`, `bounded`, and `available` precisely.
7. Non-success transactions use attempt wording.
8. Missing evidence is `Unavailable`, not zero.
9. Partial evidence is labelled as partial or bounded.
10. Technical terms remain visible or reachable.

## Header and page identity

### Page title

Preferred:

```text
Explore XRPL Lending
```

### Page subtitle

Preferred:

```text
A guided view of how Vaults, Loan Brokers, and Loans connect — and what the monitor is observing now.
```

Alternative when a shorter mobile subtitle is required:

```text
A guided view of XRPL lending structure and current observed activity.
```

### Scope badge

```text
Guided view
```

### Network context

Use existing application network/status treatment. Do not duplicate a large promotional badge.

Preferred supporting line when context copy is needed:

```text
Read-only Devnet observation. Technical evidence remains available in the Monitor and Audit views.
```

## Hero states

### Normal

Title:

```text
Explore XRPL Lending
```

Body:

```text
Start with the structure, follow the relationships, then open the technical evidence when you need it.
```

### Stale

```text
The latest monitored data is currently stale. This page is showing the most recent available observed state.
```

### Status unavailable

```text
Current network status is unavailable. The guide remains available, but live status claims are hidden until evidence returns.
```

## Three concept cards

### Vault

Heading:

```text
Vault
```

Body:

```text
Holds and accounts for a lending asset within the protocol.
```

Supporting link:

```text
Open Vaults
```

### Loan Broker

Heading:

```text
Loan Broker
```

Body:

```text
Connects lending activity to a Vault and records debt, cover, and related lending parameters.
```

Supporting link:

```text
Open Loan Brokers
```

### Loan

Heading:

```text
Loan
```

Body:

```text
Records borrower obligations, outstanding balances, terms, and payment schedule fields.
```

Supporting link:

```text
Open Loans
```

### Concept-section heading

```text
Start with three objects
```

### Concept-section supporting copy

```text
The protocol becomes easier to read once you understand how these three object types relate.
```

## Current Snapshot

### Section heading

```text
What is happening now
```

### Supporting copy

```text
A bounded summary of the latest available monitored state. Unavailable values stay unavailable rather than being shown as zero.
```

### Preferred card labels

```text
Vaults observed
Loan Brokers observed
Loans observed
Latest validated ledger
Collector freshness
Recent protocol activity
```

### Count provenance helper

When count provenance is direct:

```text
Current observed count
```

When unavailable:

```text
Count unavailable
```

When the underlying contract only supports at-least or partial semantics:

```text
At least this many observed
```

Do not use a bare `+` suffix without an accessible textual explanation.

### Latest ledger helper

```text
Latest validated ledger reported by the monitored network status.
```

### Collector freshness helper

Fresh:

```text
Collector data is current within the monitored freshness boundary.
```

Stale:

```text
Collector data is stale. Showing the latest available monitored state.
```

Unavailable:

```text
Collector freshness is unavailable.
```

## Conceptual protocol flow

### Section heading

```text
How the structure connects
```

### Supporting copy

```text
This is the conceptual flow. The observed relationship map below shows a bounded sample of real current relationships.
```

### Node copy

#### Vault

```text
Vault
Asset accounting context
```

#### Loan Broker

```text
Loan Broker
Debt and cover context linked to a Vault
```

#### Loan

```text
Loan
Borrower obligations, balances, and schedule fields
```

#### Activity

```text
Activity
Payments, management changes, defaults, and deletions where indexed
```

### Connector labels

Preferred concise labels:

```text
linked to
contains relationship context for
changes through
```

Do not use `funds`, `lends`, `collateralizes`, or `liquidates` as generic connector labels unless the exact protocol semantics and displayed relationship support that statement.

## Relationship Explorer

### Section heading

```text
Observed relationships
```

### Supporting copy

```text
A bounded sample of current Vault → Loan Broker → Loan relationships from the monitored context.
```

### Bounded-sample badge

```text
Bounded sample
```

### Selected label

```text
Selected
```

### Technical links

```text
Open Vault details
Open Loan Broker details
Open Loan details
```

### Empty state

```text
No related Loans were returned in this bounded current view.
```

### Partial state

Generic:

```text
Showing a bounded sample of observed relationships.
```

When pagination proves additional data exists:

```text
Showing the first page of observed relationships. More are available.
```

### Unavailable state

```text
Relationship data is currently unavailable for this context.
```

### Stale state

```text
Relationship data is shown from the latest available monitored state, which is currently stale.
```

### Same-context resolution failure

```text
The related object could not be resolved in the current monitored context.
```

Do not silently substitute an archived or different-epoch object.

## Selected Loan panel

### Section heading

```text
Selected Loan
```

### Supporting copy

```text
A readable summary of one Loan from the bounded relationship view.
```

### Preferred field labels

```text
Loan ID
On-ledger state
Schedule state
Asset
Outstanding principal
Total value outstanding
Regular payment amount
Payments remaining
Next payment due
Grace period
Related Loan Broker
Related Vault
```

### Plain-language summary templates

Use only fields actually available.

#### Active and current schedule

```text
This Loan is active on-ledger. Its current schedule state is {schedule_state}, with {payments_remaining} scheduled payments remaining.
```

#### Impaired

```text
This Loan is marked as impaired on-ledger. Its schedule state is shown separately as {schedule_state}.
```

#### Defaulted

```text
This Loan is marked as defaulted on-ledger. Schedule-derived status is shown separately and does not replace the protocol state.
```

#### Default eligible but not defaulted

```text
The schedule is default eligible, but the Loan is not marked as defaulted on-ledger.
```

#### Complete schedule

```text
The current schedule state is complete. Open the lifecycle and technical views for indexed historical evidence.
```

### Missing schedule field

```text
This schedule value is unavailable in the current evidence.
```

### Date helper

```text
Times are shown in UTC.
```

### Technical CTA

```text
Open full Loan details
```

## Recent Activity

### Section heading

```text
Recent protocol activity
```

### Supporting copy

```text
Plain-language summaries of bounded indexed activity, with canonical transaction types and results kept visible.
```

### Generic success fallback

```text
Protocol activity was recorded successfully.
```

Technical line:

```text
{transaction_type} · {result_code}
```

### Generic non-success fallback

```text
Protocol activity was attempted but did not succeed.
```

Technical line:

```text
{transaction_type} · {result_code}
```

### Transaction detail CTA

```text
Open transaction details
```

### Empty state

```text
No indexed protocol activity was returned in this bounded view.
```

### Unavailable state

```text
Recent indexed activity is currently unavailable.
```

### Partial state

```text
Showing a bounded recent activity view.
```

## Activity templates

These templates follow `explorer-v1-translation-dictionary.md` and still require E1-4 validation against final normalized semantics.

### Vault

```text
A Vault was created.
Assets were deposited into a Vault.
Assets were withdrawn from a Vault.
Vault settings were updated.
A Vault clawback transaction succeeded.
A Vault was removed from current state.
```

### Loan Broker

```text
Loan Broker settings were created or updated.
Cover was deposited for a Loan Broker.
Cover was withdrawn from a Loan Broker.
A Loan Broker cover clawback transaction succeeded.
A Loan Broker was removed from current state.
```

### Loan

```text
A Loan was created or established.
A payment was recorded for a Loan.
A regular payment was recorded for a Loan.
The recorded payment completed the remaining Loan payment obligation.
An overpayment was recorded for a Loan.
The Loan was marked as impaired.
The Loan impairment state was removed.
The Loan was marked as defaulted.
A Loan was removed from current state.
```

Subtype-specific lines are used only when the approved evidence explicitly supports the subtype.

### Non-success transformation

For known actions, prefer:

```text
{Action} was attempted but did not succeed.
```

Examples:

```text
A Loan payment was attempted but did not succeed.
Vault deletion was attempted but did not succeed.
A Loan default-state change was attempted but did not succeed.
```

Never transform a non-success result into completed-state wording.

## How to read this page

### Section heading

```text
How to read this page
```

### Supporting copy

```text
Explorer explains the structure in plain language. The Monitor and Audit views keep the exact technical evidence.
```

### Glossary items

#### Current state

```text
The latest resolved object state from the verified base plus validated incremental updates.
```

#### Indexed history

```text
Historical evidence reconstructed from the collected validated-ledger observation window.
```

#### Lifecycle

```text
Recorded Loan creation, payment, management, impairment, unimpairment, default, and deletion evidence where indexed.
```

#### Archived

```text
An object removed from current state but retained in indexed historical evidence.
```

#### Direct

```text
Read from a validated ledger object or transaction.
```

#### Derived

```text
Calculated from approved direct inputs using a documented formula.
```

#### Indexed

```text
Reconstructed from collected historical evidence.
```

#### Unavailable

```text
Not available or not supported as a fact in the current evidence.
```

### Methodology CTA

```text
Read the methodology
```

## Technical View transition

### Heading

```text
Ready for the technical details?
```

### Body

```text
Open the Monitor and Audit views to inspect exact identifiers, fields, transactions, lifecycle evidence, archive context, provenance, and network status.
```

### Primary CTA

```text
Open technical view
```

### Secondary CTAs

```text
Open Loans
Open Activity
Open Lifecycle
Open Methodology
```

The exact CTA set may be context-sensitive, but it must not prefetch expensive routes on page load merely because links are visible.

## Loading copy

Use concise content-specific labels:

```text
Loading current snapshot…
Loading observed relationships…
Loading selected Loan…
Loading recent activity…
```

Do not use indefinite promotional copy such as `Discovering opportunities…`.

## Error copy

### Generic section error

```text
This section could not be loaded. Technical evidence may still be available in the Monitor view.
```

### Relationship error

```text
Observed relationships could not be loaded for this bounded view.
```

### Activity error

```text
Recent indexed activity could not be loaded.
```

### Retry label

```text
Try again
```

## Empty-copy rule

Empty copy must describe what the bounded query returned, not make a universal protocol claim.

Preferred:

```text
No related Loans were returned in this bounded current view.
```

Prohibited:

```text
There are no Loans.
```

unless the exact approved complete count contract proves zero.

## Identifier-copy rule

Visible identifiers may be shortened, but:

- accessible name exposes the full value;
- copy action copies the full value;
- technical detail link uses the full canonical identifier;
- shortened text is never treated as a unique identifier by itself.

Preferred visible pattern:

```text
A1B2C3D4…9F8E7D6C
```

Accessible label pattern:

```text
Loan ID {full_identifier}
```

## Copy review gate

Before E1-2 and E1-4 implementation, review this document against:

- actual final route and component hierarchy;
- final M6 resource evidence;
- final API response shapes;
- final normalized Activity semantics;
- accessibility and responsive constraints;
- terminology changes accepted after this baseline.

If the evidence cannot support a specific sentence, narrow or remove the sentence rather than adding a speculative explanation.
