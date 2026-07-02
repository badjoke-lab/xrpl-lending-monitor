# Status model

## Rule

Loan state is represented by two independent dimensions:

1. **On-ledger status** — what the validated Loan object and its flags say.
2. **Schedule status** — what the payment dates imply at the current time.

The interface and API must never collapse these into one ambiguous label.

## On-ledger status

Allowed values:

- `active` — Loan object exists and neither impaired nor defaulted flag is set.
- `impaired` — Loan object exists with the impaired flag set.
- `defaulted` — Loan object exists with the default flag set.
- `deleted` — Loan object no longer exists and a deletion event is indexed.
- `unknown` — data is incomplete or unrecognized; never guess.

If protocol rules allow combinations of flags, preserve the raw flags and expose all matching facts. The normalized status engine must be covered by fixtures from real Devnet transactions.

## Schedule status

Allowed values:

- `current` — before the next payment due time.
- `payment_due` — due time reached, but grace period has not ended.
- `in_grace_period` — retained as a user-facing alias only if a separate due and grace boundary is useful; canonical rules must define it consistently.
- `default_eligible` — due time plus grace period has passed, but this does not mean the Loan is defaulted.
- `complete` — no further scheduled payment remains, based on indexed lifecycle evidence.
- `not_applicable` — deleted or unavailable schedule data.
- `unknown` — required schedule fields are absent or invalid.

Implemented boundary semantics:

- before `NextPaymentDueDate`: `current`;
- at `NextPaymentDueDate` and before `NextPaymentDueDate + GracePeriod`: `payment_due`;
- at or after `NextPaymentDueDate + GracePeriod`: `default_eligible`;
- deleted Loans: `not_applicable`;
- zero remaining payments: `complete`;
- missing required schedule fields: `unknown`.

`in_grace_period` is retained only as a possible user-facing alias for `payment_due`; it is not a separate canonical persisted value. The API must expose timestamps used in the decision.

## Required API shape

```json
{
  "on_ledger_status": "active",
  "schedule_status": "default_eligible",
  "status_source": {
    "flags": 0,
    "next_payment_due": "2026-07-01T10:00:00Z",
    "grace_period_seconds": 60,
    "default_eligible_at": "2026-07-01T10:01:00Z",
    "evaluated_at": "2026-07-01T12:15:00Z"
  }
}
```

## Display rules

Good:

```text
On-ledger: Active
Schedule: Default eligible
Eligible since: 2h 14m
```

Prohibited:

```text
Defaulted
```

when only the deadline calculation says default is possible.

## Vault and Broker operational conditions

These are factual conditions, not risk scores:

- `cover_shortfall`
- `debt_capacity_exceeded`
- `assets_unavailable`
- `unrealized_loss_present`
- `collector_stale`
- `object_deleted`

Each condition must include the direct fields and formula that triggered it.

## Formulas

- `default_eligible_at = NextPaymentDueDate + GracePeriod`
- `debt_utilization = DebtTotal / DebtMaximum`, when the maximum is non-zero
- `actual_cover_ratio = CoverAvailable / DebtTotal`, when debt is non-zero
- `required_minimum_cover = DebtTotal × CoverRateMinimum`, using the protocol-defined rate units
- `cover_surplus = CoverAvailable - required_minimum_cover`

Rate-unit conversion must be centralized and tested against current protocol definitions.

## Time handling

- Preserve raw Ripple epoch values.
- Convert using the XRPL epoch offset.
- Store and display UTC.
- Schedule status is evaluated against a recorded `evaluated_at` timestamp.
- Historical pages must evaluate status at the historical event time, not only at the present time.

## Deleted Loans

A deleted Loan receives `on_ledger_status=deleted`. Its last non-deleted status, deletion transaction, deletion reason, and final schedule state remain available in the lifecycle record.
