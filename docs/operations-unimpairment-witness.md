# Devnet unimpairment witness operation

This document defines the bounded operation for obtaining the single remaining M1 HYB-7 semantic witness: a real post-replacement-boundary Loan unimpairment transition.

The monitor remains read-only. This repository, its Worker, D1 database, GitHub Actions, and deployment configuration must not hold a seed, private key, signing key, wallet session, or transaction-submission capability.

## Current reason for this operation

The 2026-07-07 13:00 UTC production probe reached a healthy zero-lag head with contiguous continuation and all required HYB-7 paths observed except unimpairment. M1 `validatedHeadReached` is observed. `liveContinuation` and M1 exit remain blocked only because no real unimpairment source or lifecycle transition has yet been observed.

Natural Devnet evidence remains preferred. A deliberate witness is considered only when natural evidence remains absent and must be produced by a separately controlled external Devnet actor.

## Upstream protocol basis

The accepted protocol behavior is taken from the XRPLF `rippled` implementation at the reviewed upstream commit used for this operation.

Relevant source paths:

- `include/xrpl/protocol/TxFlags.h`;
- `include/xrpl/protocol_autogen/transactions/LoanManage.h`;
- `src/libxrpl/tx/transactors/lending/LoanManage.cpp`.

The protocol implementation establishes these constraints:

- `LoanManage` accepts one mutually exclusive state-management flag at a time;
- `tfLoanUnimpair` is `0x00040000` (`262144`);
- the valid recovery transition is impaired to unimpaired;
- a defaulted Loan cannot be modified;
- an already unimpaired Loan cannot be unimpaired again;
- a fully paid Loan cannot be modified;
- the submitting `Account` must equal the owner of the Loan's related Loan Broker;
- successful unimpairment reverses the Loan's unrealized-loss contribution in the Vault, clears the Loan impaired flag, and restores or recomputes the next payment due date according to protocol rules.

The monitor does not reproduce or bypass those checks. The ledger is authoritative.

## Required separation of duties

### Monitor repository

May:

- discover candidate evidence through read-only APIs;
- record public object and lifecycle identifiers needed for verification;
- observe the validated transaction after it appears on Devnet;
- verify protocol event, lifecycle, balance-history, current-state, cursor, and freshness consistency;
- run the existing read-only M1 exit review after all gates are satisfied.

Must not:

- store actor credentials;
- derive or import a seed;
- sign a transaction;
- submit a transaction;
- expose a public write endpoint;
- add wallet or lending controls to the product;
- mark the path observed before validated-ledger evidence exists.

### External Devnet actor

The external operator controls the Loan Broker owner account and any signing material outside this repository. The actor may submit one bounded Devnet `LoanManage` transaction only after the preconditions below are checked.

Actor material must not be copied into repository files, pull requests, Actions inputs, logs, artifacts, screenshots, issue comments, or monitor configuration.

## Candidate preconditions

A candidate is eligible only when read-only evidence confirms all of the following at the same current network and epoch context:

1. the Loan exists in current state;
2. the Loan is currently impaired;
3. the Loan is not defaulted;
4. `PaymentRemaining` is non-zero;
5. the related Loan Broker exists;
6. the external actor actually controls the Loan Broker owner account;
7. the related Vault and Loan state are internally consistent enough for the protocol to reverse the unrealized-loss contribution;
8. the monitor is healthy and fresh before the witness transaction is sent.

Candidate discovery must be repeated immediately before external submission because a Loan can change state between initial selection and signing.

## Minimal transaction intent

The semantic intent is one `LoanManage` transaction with:

```json
{
  "TransactionType": "LoanManage",
  "Account": "<loan-broker-owner-account>",
  "LoanID": "<current-impaired-loan-id>",
  "Flags": 262144
}
```

Common transaction fields such as fee, sequence or ticket, and bounded last-ledger validity are supplied by the external actor's approved Devnet signing/submission method.

This example defines intent only. It is not a signed transaction, does not contain credentials, and is not a command for the monitor Worker.

## Execution order

1. Keep permanent collector monitoring active and confirm healthy zero lag.
2. Perform bounded read-only candidate discovery.
3. Confirm candidate current state and Loan Broker owner relationship.
4. Confirm the external operator controls that exact owner account without transferring credentials into this project.
5. Construct and review one bounded Devnet `LoanManage` unimpair transaction externally.
6. Re-check candidate state immediately before signing.
7. Sign and submit outside the monitor repository and infrastructure.
8. Wait for validated-ledger inclusion; do not infer success from local signing or a provisional response.
9. Let the normal collector observe the ledger with no cursor manipulation or special ingestion path.
10. Re-run continuation diagnostics and require `unimpaired` to become `observed` with no inconsistent HYB-7 paths.
11. Re-run M1 exit diagnostics and require `liveContinuation` to become `observed`.
12. Run `.github/workflows/m1-exit-review.yml` with `require_ready=true` and retain the evidence artifact.
13. Update implementation status from the successful exit evidence before proceeding to M5-5.

## Abort conditions

Abort without submission when any of these is true:

- the Loan is no longer impaired;
- the Loan became defaulted;
- the Loan became fully paid;
- the Loan Broker owner relationship changed or cannot be verified;
- the actor does not control the exact current Loan Broker owner account;
- the monitor is stale, behind, inconsistent, or reporting collector failures;
- a natural validated unimpairment witness has already appeared;
- the proposed transaction contains multiple LoanManage state flags;
- the external submission method would expose credentials to this repository or CI.

Do not retry a failed state-changing transaction automatically. Re-read current state and classify the ledger result before deciding whether another externally controlled attempt is justified.

## Success evidence

This operation is complete only when normal read-only production diagnostics show:

- a validated `LoanManage` source event representing the unimpairment transition;
- an `unimpaired` lifecycle record;
- consistent current Loan state;
- consistent Vault loss/balance history where the transition changes those records;
- no HYB-7 `inconsistent` state;
- healthy cursor/overlay agreement and freshness;
- `liveContinuation: observed`;
- a passing M1 exit review with readiness enforcement.

A submitted transaction, a locally signed payload, or an unvalidated response is not sufficient evidence.
