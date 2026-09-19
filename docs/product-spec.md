# Product specification

## Product definition

XRPL Lending Monitor is an independent, read-only monitor and historical audit surface for the XRPL Lending Protocol.

It answers two distinct questions:

- **Current:** what Vaults, Loan Brokers, and Loans exist now and what are their current protocol fields?
- **History:** what changed, when did it change, what did the object look like before and after, and what deleted objects or lifecycle events are preserved?

The product is not a wallet, lending frontend, broker service, investment product, credit-rating system, payment product, or substitute for the XRPL protocol specification.

## Current release scope

Included:

- XRPL Lending Devnet;
- Vault, LoanBroker, and Loan current projections;
- recognized Lending/Single Asset Vault activity;
- object relationships;
- Loan lifecycle reconstruction;
- before/after field changes;
- deleted-object archive where history was collected;
- balance/cover/loss history where derivable;
- explicit provenance, freshness, continuity, epoch, and coverage boundaries.

Excluded:

- Mainnet until separately approved;
- signing and transaction submission;
- lending/repayment/deposit/withdrawal actions;
- wallet connection as a requirement;
- fiat pricing and cross-asset totals;
- proprietary risk, safety, credit, or investment scores;
- hidden inference of missing history.

## Product principles

1. Current state and history are separate truth surfaces.
2. Current state is derived from a complete verified base plus verified contiguous live mutations.
3. Historical coverage is never implied across an uncollected gap.
4. On-ledger status and schedule-derived status remain separate.
5. XRP, IOU, and MPT quantities remain distinct.
6. Every public value has direct, derived, indexed, or unavailable provenance.
7. Deleted does not mean forgotten when the deletion was collected.
8. Unavailable is not zero.
9. Network, epoch, ledger, freshness, and coverage context are visible.
10. Normal page rendering must use bounded static artifact reads.
11. The public product remains read-only.
12. Infrastructure failure must degrade to stale/unavailable data, not fabricate continuity.

## Public information architecture

### Monitor

- Overview
- Vaults
- Loan Brokers
- Loans
- Activity
- Search

### Audit

- Lifecycle
- Archived Objects
- Cover & Loss
- Devnet Epochs

### System

- Network Status
- Methodology
- API/artifact documentation

### Project

- About
- Contact

Existing routes and UI specifications remain the intended presentation baseline unless explicitly revised during the DB-less migration.

## Overview

Overview must expose, when supported by the active artifacts:

- Devnet/epoch identity;
- active Current base ledger;
- live Current ledger;
- Current age and lag;
- history coverage ranges;
- Vault, LoanBroker, Loan, and total current-object counts;
- recent Lending activity;
- collection/publication errors or stale warnings;
- explicit historical gaps;
- provenance and methodology links.

No cross-asset aggregate may be introduced without an approved pricing model.

## Current entity pages

Vault, Loan Broker, and Loan lists/details preserve existing human-readable fields, relationships, derived formulas, raw identifiers, and provenance.

Normal list/detail reads MUST be bounded. The browser must not download the complete multi-million-object Current set.

Exact lookup and detail navigation are higher priority than arbitrary global sorting during the initial DB-less cutover. Any filter or sort retained publicly must have a precomputed/indexed artifact contract.

## Activity and audit pages

Activity covers recognized transaction types including:

- VaultCreate, VaultDeposit, VaultWithdraw, VaultSet, VaultClawback, VaultDelete;
- LoanBrokerSet, LoanBrokerCoverDeposit, LoanBrokerCoverWithdraw, LoanBrokerCoverClawback, LoanBrokerDelete;
- LoanSet, LoanPay, LoanManage, LoanDelete.

Audit pages expose only collected and verified records.

Loan detail should preserve:

- current terms and balances;
- current schedule facts;
- related Broker and Vault;
- lifecycle events;
- payments;
- impair/unimpair/default/delete evidence;
- before/after state changes;
- raw decoded object;
- archived final state when available.

## Historical coverage

Historical coverage is range-based.

The retained canonical archive currently proves one historical range:

- epoch: `devnet-3371675`;
- ledger 3,371,676 through 3,932,301;
- 560,626 ledgers;
- 1,136 history segments.

The gap after that range is not silently bridged.

A new live-history generation starts from the DB-less collector cutover point. Backfill of intervening ledgers is a separate roadmap unit.

## Release quality

A DB-less public release requires:

- one verified complete Current base;
- verified contiguous live catch-up;
- bounded static reads for representative pages;
- explicit history coverage/gap display;
- interruption/retry/idempotence evidence;
- static deployment evidence;
- accessibility/responsive regression evidence;
- production-shaped soak without D1, Queue, Supabase, or another canonical hosted database.
