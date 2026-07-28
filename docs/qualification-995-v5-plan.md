# Qualification 995 v5 plan

## Purpose

Run a new fixed twelve-slot pre-soak qualification after the production immutable-history repair. Earlier qualification results are not reusable because the production history identity changed.

## Fixed window

- Arm: 2026-07-28 16:05 UTC / 2026-07-29 01:05 JST
- Prepare and freeze identity: 2026-07-28 16:25 UTC / 2026-07-29 01:25 JST
- First slot: 2026-07-28 16:30 UTC / 2026-07-29 01:30 JST
- Twelfth slot: 2026-07-28 17:25 UTC / 2026-07-29 02:25 JST
- Evaluate: 2026-07-28 17:30:30 UTC / 2026-07-29 02:30:30 JST

The window does not cross a protected four-hour UTC collector boundary.

## Frozen identities

- Runtime SHA: `5b56de459e97495a9358f0e203c056d2a99afc6b`
- History branch head: `5d7bf6d330407c7ead237b3885d4330a8d268ce6`
- History data commit: `12252ce9df0d5ab50adc51e2743edb8ff03989dd`
- History chain: `canonical-devnet-3371676-3932301-v3`
- History boundary: ledger `3,932,301`
- Exact index: 1,024 buckets / 33,811,930 records

The workflow additionally freezes the actual Worker deployment/version, current-state branch head, base binding, epoch, cron, Queue and Cloudflare bindings immediately before the window.

## Qualification gates

- exactly twelve completed Queue slots at 300,000 ms spacing;
- all attributed metrics committed with no error and terminal lag zero;
- complete contiguous history-window coverage for the accepted ledger range;
- decoded `gzip-base64-v1` bundles with all five semantic arrays;
- end-hash and parent-hash verification against XRPL Devnet;
- public and XRPL witnesses for protocol events, object changes, lifecycle, archives and balance history;
- fast-lane/canonical overlay final equality;
- zero compact, foldable and stale rows;
- unchanged runtime, deployment, base, epoch, current-state and history identities;
- post-window `/api/status/pre-soak-readiness` remains passed;
- resource-envelope thresholds remain satisfied.

## Explicit non-claims

A v5 pass does not mean formal release. It does not certify independent 24-hour evidence retention, the 288-slot soak, browser release behavior, accessibility, backup/recovery or public-host readiness.

The next gate after a pass is independent immutable 24-hour semantic-evidence retention.
