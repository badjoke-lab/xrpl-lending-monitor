# R4F G4 revision-4 memory gate closure

Date: 2026-08-07
Issue: #1261
Status: G4 pass

## Decision

G4 is formally closed as `pass` from the already completed authorized bounded offline replay. This closure does not rerun the one-shot workflow, select revision 4, or authorize R5 recovery mutation.

The oldest unresolved gate remains G3. G5 through G10 also remain unresolved.

## Execution identity

- source commit: `5a25d091919dc2d90116ca9cc4e92335031be9f2`;
- source title: `Run a bounded offline G4 memory replay (#1270)`;
- authorization: Issue #1261 comment `5401115525`;
- workflow run: `31086304493`;
- `quality`: success;
- `r4f-g4-memory-replay`: success;
- source range: `4138468-4138491`;
- source ledger count: `24`.

## Retained artifact

- name: `r4f-g4-memory-replay-evidence`;
- artifact ID: `8961530550`;
- size: `160152` bytes;
- digest: `sha256:e0b4157b70faea269c61f643b78882dffb30a9168632c77e5ec6972673009ed7`;
- created: `2026-08-06T08:47:12Z`;
- expires: `2026-08-20T08:47:12Z`;
- expired at closure: false.

The artifact downloaded from GitHub and the reviewed owner-supplied archive are byte-identical. Their complete ZIP SHA-256 digests and sizes match. All 24 retained source ledger JSON files match `source/manifest.json` by byte size and SHA-256.

Retained evidence includes:

- `source/manifest.json`;
- 24 source ledger JSON files;
- `exact.json`;
- `heavier.json`;
- `evidence.json`;
- `verified.json`;
- `summary.md`.

## Locked policy

- memory metric: process RSS bytes;
- memory halt: `234881024` bytes (224 MiB);
- claim cap: `12` ledgers;
- rolling egress halt: 4 GiB / 31 days;
- invocation halt: 400,000 / 31 days.

No guard was changed or bypassed.

## Exact 12-ledger shape

- retained / processed: `12 / 12`;
- baseline RSS: `61845504` bytes;
- peak RSS: `77430784` bytes;
- increase from baseline: `15585280` bytes;
- headroom below the halt: `157450240` bytes;
- memory halt recurred: false;
- claim-cap override used: false.

## Heavier retained shape

- retained / processed: `24 / 12`;
- baseline RSS: `59494400` bytes;
- peak RSS: `75296768` bytes;
- increase from baseline: `15802368` bytes;
- headroom below the halt: `159584256` bytes;
- memory halt recurred: false;
- claim-cap override used: false.

## Verifier result

- evidence class: `bounded_offline_replay`;
- `proofReady`: true;
- `blockingReasons`: empty;
- maximum peak RSS: `77430784` bytes;
- minimum headroom: `157450240` bytes;
- required replay shapes present: true.

Important retained digests:

- source manifest core: `9a2edbae7f0e07151c4d762b995963bdd3c0db9098f94d50a94587c4002a5d4a`;
- harness: `9644dfd0ab1a214dd37f588b6006d56d1ea77f4d33529c96fd5d2ea532f5e4d8`;
- environment: `080b608cafa906fabbe544c00bcf538d9590b2704a6ff567b94337a248e81029`;
- replay output: `dab06e053672cd691ba1c15e7c56cbb62f0776476c435dc2c0c52e2cb8454de5`.

## Safety state

- production credentials used: false;
- production Supabase mutation: false;
- R5 recovery mutation committed: false;
- transaction submission: false;
- replay network access: false;
- public reader unchanged: true;
- Mainnet disabled: true;
- stabilization authorized: false;
- soak authorized: false;
- revision-4 selection: `not_selected`.

## Qualification effect

The qualification input advances only G4:

```text
G1 pass
G2 pass
G3 unresolved
G4 pass
G5 unresolved
G6 unresolved
G7 unresolved
G8 unresolved
G9 unresolved
G10 unresolved
```

The candidate remains a conditional, unselected revision. G4 success does not establish provider reconciliation, steady convergence, catch-up convergence, failure accounting, restore independence, a production-shaped proof unit, or the final selection decision.

The machine-readable closure is retained at [`../../ops/r4f/revision4-memory-gate-closure.json`](../../ops/r4f/revision4-memory-gate-closure.json).
