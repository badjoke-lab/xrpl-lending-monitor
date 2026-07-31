# Implementation status

Last updated: `2026-07-31`.

## Current phase

XRPL Lending Monitor is **not formally released**.

Production collection is intentionally stopped after extended Queue operation exposed a
per-invocation subrequest failure. Queue delivery is paused, its backlog is purged, and
Worker cron is empty. Formal recovery and any new qualification are not approved.

The public read surface remains a production test state, not a formal Devnet release.

## Active P0 subrequest correction

The fixed first 12 Queue slots completed with 1,152 contiguous ledgers and no slot or
run errors. Extended operation later recorded 97 committed runs, one transient D1
connection error, and three subrequest-limit errors in 26 seconds. The repeated
subrequest failures had no committed ledger range.

The focused correction keeps one pass per delivery, lowers and enforces the fast-lane
maximum from 96 to the retained 32-ledger safe profile, treats caught subrequest
exhaustion as terminal without successor publication, and gives retryable failures a
five-minute Queue delay. This repository change is not deployed.

## Verified production identities

- Network: `devnet`
- Mainnet enabled: `false`
- Public Worker: `https://xrpl-lending-monitor.badjoke-lab.workers.dev`
- Cron: empty
- Queue: one producer, one consumer, batch size 1, concurrency 1
- Active Worker version: `0d7eb873`
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

The P0 subrequest correction must be reviewed and merged before a separate production
recovery decision. Do not start qualification from this implementation pull request.

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
