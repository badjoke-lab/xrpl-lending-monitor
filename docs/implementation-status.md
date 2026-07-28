# Implementation status

Last updated: `2026-07-28T14:03Z`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The Devnet production collector, Queue, five-minute cron, fast lane, canonical overlay, public Worker and hybrid history APIs are operating. The P0 immutable-history gap has been repaired and the production `history-data` branch now matches the immutable current-state base at ledger `3,932,301`.

This is a production test state, not a formal Devnet release.

## Verified production identities

- Network: `devnet`
- Mainnet enabled: `false`
- Public Worker: `https://xrpl-lending-monitor.badjoke-lab.workers.dev`
- Cron: one `*/5 * * * *`
- Queue: one producer, one consumer, batch size 1, concurrency 1
- Runtime SHA: `5b56de459e97495a9358f0e203c056d2a99afc6b`
- Immutable current-state base: ledger `3,932,301`
- Base hash: `7D026FED85BCA2BDCFE450A0F3537707A43B4D08E1D2AE57AFBC54D88EBE1828`
- Production history branch head: `5d7bf6d330407c7ead237b3885d4330a8d268ce6`
- History data commit: `12252ce9df0d5ab50adc51e2743edb8ff03989dd`
- History chain: `canonical-devnet-3371676-3932301-v3`
- History publication: 1,136 segments / 560,626 ledgers
- Exact index: 1,024 buckets / 33,811,930 records

## P0 immutable-history recovery

Completed on 2026-07-28.

The production verification proved:

- `/api/status/history-source` serves terminal ledger `3,932,301`;
- immutable history and current-state base match;
- the 1,024-bucket exact index is active;
- the fixed Vault/object-change witness resolves through the public production API;
- `/api/status/pre-soak-readiness` returned `passed: true`;
- projection parity and three recent five-minute runs passed;
- no Worker, D1, cron, Queue or Mainnet change was made by the history promotion.

This recovery removes the history/base mismatch blocker. It does not complete the release.

## Active next gate

Issue #995 controls the new history-recovered twelve-slot qualification.

- Workflow: `.github/workflows/complete-history-12-slot-qualification-995-v5.yml`
- Fixed start: `2026-07-28T16:30:00Z` (`2026-07-29 01:30 JST`)
- Fixed final slot: `2026-07-28T17:25:00Z` (`2026-07-29 02:25 JST`)
- Evaluation: `2026-07-28T17:30:30Z` (`2026-07-29 02:30:30 JST`)
- Expected slots: 12
- Production mutation during the qualification: none

A failed gate invalidates the complete window. The next attempt must restart from slot 1.

## Remaining formal-release gates

1. Pass the history-recovered twelve-slot qualification.
2. Deploy and verify independent immutable semantic-evidence retention; the bounded live-tail ring is not sufficient evidence for a 24-hour audit.
3. Arm the retention system before a fixed soak boundary.
4. Pass 288 real five-minute slots over 24 hours with complete ledger/hash and semantic evidence.
5. Complete the final semantic cross-audit against XRPL transactions and AffectedNodes.
6. Complete real-data browser regression and representative production behavior smoke.
7. Complete integrity, retry, reset, backup, restore and rollback verification.
8. Complete measured Worker, Queue, RPC, D1, storage and API resource-envelope verification.
9. Complete Explorer v1 if it remains a release requirement after roadmap reconciliation.
10. Complete desktop/mobile visual, accessibility, performance, security and cross-browser audits.
11. Configure the final public host, canonical URLs, metadata, sitemap, Search Console and feedback routes.
12. Freeze operations runbooks, watchdogs, alerts, backup and recovery procedures.
13. Produce the final release record and owner sign-off.

## Operating restrictions

- Do not call the product formally released before every release gate passes.
- Do not equate lag zero, HTTP 200 or a successful history promotion with formal release.
- Do not enable Mainnet.
- Do not shorten the five-minute cadence.
- Do not remove semantic history classes.
- Do not start the 24-hour soak before independent immutable evidence retention is deployed and armed.
- Do not skip a failed ledger or advance a cursor after incomplete persistence.
