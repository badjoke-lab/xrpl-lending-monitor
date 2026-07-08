# M6-I1 deterministic integrity fixture catalog

Last updated: 2026-07-08.

## Purpose

This document prepares the deterministic fixture catalog for M6-I1.

It does not start M6 implementation. Fixture code begins only after:

1. M5-5 exits from retained API and browser evidence;
2. `docs/implementation-status.md` records M6-I1 as active;
3. the implementation unit re-reads `AGENTS.md`, the M6 baseline plans, and issue #283.

The catalog exists so M6-I1 can consolidate reusable integration fixtures around production semantics instead of creating a new parallel model or duplicating focused tests.

## Design goals

The fixture matrix must:

- reuse production serializers, readers, relationship resolvers, commit boundaries, and repository logic;
- keep network, epoch, base identity, cursor, and overlay watermark explicit;
- keep canonical asset identity explicit;
- support base objects, overlay upserts, tombstones, canonical history, lifecycle, archive, and balance evidence;
- support before/after evidence snapshots;
- make negative cases first-class rather than hidden setup errors;
- remain deterministic across local runs;
- be reusable by M6-I2 interruption/replay, M6-I3 reset classification, M6-I4 epoch transition, and M6-I5 catch-up/reconciliation.

The fixture layer must not reimplement production precedence, relationship resolution, epoch scoping, or commit logic inside test helpers.

## Naming convention

Stable scenario identifiers:

```text
M6-I1-F00  control / empty deterministic context
M6-I1-F01  base-only current object
M6-I1-F02  overlay-created object
M6-I1-F03  overlay-modified base object
M6-I1-F04  deleted base object
M6-I1-F05  deleted overlay-created object
M6-I1-F06  same object ID across epochs
M6-I1-F07  same object ID across base identities
M6-I1-F08  valid Vault -> Broker -> Loan chain
M6-I1-F09  cross-epoch relationship mismatch
M6-I1-F10  cross-base relationship mismatch
M6-I1-F11  canonical event-to-current integrated sequence
M6-I1-F12  asset-separated aggregate inputs
M6-I1-F13  count reconciliation base plus overlay deltas
M6-I1-F14  provenance and source identity matrix
```

Later M6 scenarios may compose these fixtures, but must preserve the stable IDs in evidence.

## Common deterministic context

Every fixture declares a context rather than relying on global defaults.

Minimum context fields:

```ts
interface M6FixtureContext {
  network: 'devnet'
  epochId: string
  baseSnapshotId: string
  baseLedgerIndex: number
  baseLedgerHash: string
  cursorLedgerIndex: number
  cursorLedgerHash: string
  overlayWatermarkLedgerIndex: number
}
```

The implementation may use richer production types, but these identities must remain explicit in fixture declarations and evidence.

Recommended deterministic contexts:

```text
CTX_A
  network: devnet
  epoch: epoch-a
  base: base-a
  base ledger: 1000
  cursor: 1004
  watermark: 1004

CTX_B_SAME_EPOCH_NEW_BASE
  network: devnet
  epoch: epoch-a
  base: base-b
  base ledger: 2000
  cursor: 2003
  watermark: 2003

CTX_C_NEW_EPOCH
  network: devnet
  epoch: epoch-b
  base: base-c
  base ledger: 100
  cursor: 103
  watermark: 103
```

Implementation IDs and hashes must use valid production-shaped values. Human-readable symbolic names belong only in test catalog metadata and evidence labels.

## Shared object family

Use one coherent deterministic object family for positive relationship scenarios.

```text
VAULT_A
  asset: XRP

BROKER_A1
  vault: VAULT_A
  asset: XRP through resolved Vault relationship

BROKER_A2
  vault: VAULT_A
  asset: XRP through resolved Vault relationship

LOAN_A1_1
  broker: BROKER_A1
  borrower: ACCOUNT_BORROWER_1

LOAN_A1_2
  broker: BROKER_A1
  borrower: ACCOUNT_BORROWER_2

LOAN_A2_1
  broker: BROKER_A2
  borrower: ACCOUNT_BORROWER_3
```

The family supports:

- one-to-many Vault -> Broker relationships;
- one-to-many Broker -> Loan relationships;
- relationship resolution;
- current counts;
- selected object projection;
- later Explorer resource fixtures without inventing a second data model.

## Shared asset family

Use at least three canonical asset identities:

```text
ASSET_XRP
  key: XRP

ASSET_IOU_USD_ISSUER_A
  key: IOU:USD:<issuer-a>

ASSET_IOU_USD_ISSUER_B
  key: IOU:USD:<issuer-b>

ASSET_MPT_A
  key: MPT:<issuance-a>
```

The two USD IOUs deliberately share a ticker-like currency label while retaining different canonical issuer identities.

Required invariant:

```text
IOU:USD:<issuer-a> != IOU:USD:<issuer-b>
```

No fixture helper may collapse them by display symbol.

## Common evidence snapshot

M6-I1 should create one reusable state snapshot helper that reads actual repository state.

Minimum evidence shape:

```ts
interface M6IntegrityEvidenceSnapshot {
  scenarioId: string
  network: string
  epochId: string
  baseSnapshotId: string
  cursor: {
    ledgerIndex: number | null
    ledgerHash: string | null
  }
  overlayWatermarkLedgerIndex: number | null
  counts: {
    processedLedgers: number
    protocolEvents: number
    objectChanges: number
    lifecycleEvents: number
    archivedObjects: number
    balanceHistoryRows: number
    overlayUpserts: number
    tombstones: number
  }
  currentObjectIds: {
    vaults: string[]
    loanBrokers: string[]
    loans: string[]
  }
  relationshipFindings: Array<{
    kind: string
    sourceId: string
    relatedId: string | null
    resolved: boolean
    reason: string | null
  }>
  assetKeys: string[]
  provenanceFindings: Array<{
    subject: string
    provenance: string
    sourceIdentity: string
  }>
}
```

Exact implementation fields may expand. The helper must read production repositories or their public internal contracts rather than infer expected state from fixture input.

## F00 — Control / empty deterministic context

### Purpose

Provide a known empty baseline for count and before/after evidence.

### Setup

- one active epoch;
- one verified base identity;
- cursor and watermark aligned at base boundary or documented initialized boundary;
- no current lending objects;
- no protocol events;
- no object changes;
- no lifecycle rows;
- no archive rows;
- no balance rows;
- no overlay upserts;
- no tombstones.

### Assertions

- every count is zero because exact empty fixture state proves zero;
- current lists are empty, not unavailable;
- epoch/base/cursor/watermark identity remains present;
- no relationship finding exists.

## F01 — Base-only current object

### Purpose

Prove fallback to verified base when no overlay mutation exists.

### Setup

- `VAULT_A` exists in the verified base;
- no overlay row for `VAULT_A`;
- no tombstone for `VAULT_A`.

### Assertions

- exact current detail returns base object;
- current list contains `VAULT_A` once;
- provenance/source identifies verified base read path;
- overlay counts remain unchanged;
- pagination order remains production-defined.

## F02 — Overlay-created object

### Purpose

Prove a post-base created object appears in current state.

### Setup

- `VAULT_A` absent from base;
- canonical incremental transaction creates `VAULT_A` after base boundary;
- overlay upsert exists with matching network, epoch, and base identity.

### Assertions

- current detail returns overlay-created object;
- current list includes object once;
- source ledger/transaction identity is preserved;
- no base fallback occurs;
- current count delta is +1.

## F03 — Overlay-modified base object

### Purpose

Prove overlay precedence over base object.

### Setup

- base `VAULT_A` contains deterministic values;
- later canonical change updates one or more supported fields;
- overlay upsert contains resulting current projection.

### Assertions

- exact detail returns overlay values;
- unchanged fields preserve canonical projection semantics;
- current list contains one object, not base plus overlay duplicates;
- object-change evidence matches before/after values;
- current count does not change.

## F04 — Deleted base object

### Purpose

Prove tombstone suppresses base fallback.

### Setup

- base contains `VAULT_A`;
- later validated deletion creates archive evidence and current tombstone.

### Assertions

- current detail returns not found/current exclusion according to production contract;
- current list excludes `VAULT_A`;
- archive exact lookup retains deletion evidence;
- history remains queryable where indexed;
- count delta is -1;
- base object is never resurrected by fallback.

## F05 — Deleted overlay-created object

### Purpose

Cover the gap where an object is created after base and later deleted.

### Setup

1. `LOAN_A1_1` absent from base;
2. validated creation produces history/lifecycle evidence and overlay upsert;
3. later validated deletion produces archive/lifecycle evidence and tombstone/current exclusion.

### Assertions

- final current state excludes the Loan;
- archive retains final state/deletion identity;
- lifecycle preserves creation and deletion sequence;
- current count net delta is zero relative to base;
- no stale overlay upsert wins over later tombstone;
- replay does not duplicate lifecycle/archive evidence.

## F06 — Same object ID across epochs

### Purpose

Prove epoch scope prevents implicit merge of identical object IDs.

### Setup

- same canonical-looking object ID appears in `epoch-a` and `epoch-b` fixture contexts;
- objects have intentionally different deterministic values and source ledgers.

### Assertions

- current context returns only active epoch object;
- epoch-aware history can distinguish both records;
- relationship resolver never joins across epochs;
- counts remain epoch-scoped;
- search result context remains explicit;
- evidence snapshot records distinct epoch identities.

Negative assertion:

```text
same object ID != permission to join epochs
```

## F07 — Same object ID across base identities

### Purpose

Prove base identity mismatch fails closed within one epoch.

### Setup

- same object type/ID exists in fixture data for `base-a` and `base-b` contexts;
- overlay mutation is bound to `base-a`;
- reader is opened for `base-b`.

### Assertions

- mismatched overlay is rejected or unavailable according to production contract;
- reader never applies `base-a` overlay to `base-b` base;
- source identity mismatch appears in evidence;
- no silent fallback masks the mismatch where production logic requires fail-closed behavior.

## F08 — Valid Vault -> Broker -> Loan chain

### Purpose

Provide the primary reusable relationship fixture.

### Setup

Use:

```text
VAULT_A
  -> BROKER_A1
       -> LOAN_A1_1
       -> LOAN_A1_2
  -> BROKER_A2
       -> LOAN_A2_1
```

Mix base and overlay locations deliberately:

- `VAULT_A`: base;
- `BROKER_A1`: base modified by overlay;
- `BROKER_A2`: overlay-created;
- `LOAN_A1_1`: base modified by overlay;
- `LOAN_A1_2`: overlay-created;
- `LOAN_A2_1`: base or overlay-created according to implementation convenience, but documented.

### Assertions

- every Loan resolves Broker and Vault in same context;
- every Broker resolves Vault in same context;
- list serializers expose relationship summaries consistently;
- current counts reconcile;
- no N+1 behavior claim is made from fixture itself;
- provenance/source identities are explicit.

## F09 — Cross-epoch relationship mismatch

### Purpose

Prove same-looking related IDs cannot bridge epochs.

### Setup

- Loan belongs to `epoch-b`;
- referenced Broker exists only in `epoch-a`, or same ID has different `epoch-b` meaning intentionally excluded from setup.

### Assertions

- relationship remains unresolved/fails closed;
- no automatic link to archived `epoch-a` object;
- no current projection silently substitutes old epoch object;
- relationship finding records reason;
- public-safe error/unavailable semantics remain compatible with production serializer behavior.

## F10 — Cross-base relationship mismatch

### Purpose

Prove relationship resolution respects active base-plus-overlay context.

### Setup

- Loan is in `base-b` current context;
- referenced Broker evidence is bound only to incompatible `base-a` overlay/current context.

### Assertions

- relationship fails closed or remains explicitly unresolved;
- reader never joins incompatible base contexts;
- source identity mismatch is observable in fixture evidence;
- no stale object is substituted.

## F11 — Canonical event-to-current integrated sequence

### Purpose

Provide one coherent transaction sequence tying history and current projections together.

### Recommended sequence

```text
T1  VaultCreate or pre-existing verified base Vault context
T2  LoanBrokerSet creates/updates BROKER_A1
T3  LoanSet creates LOAN_A1_1
T4  LoanPay modifies Loan balances/payment remaining
T5  LoanManage impairs Loan
T6  LoanManage unimpaired transition
T7  LoanManage default transition or a separate deterministic Loan for default path
T8  LoanDelete removes Loan from current state
```

The exact sequence may use separate Loans where protocol preconditions require it. Do not force an invalid transaction order for fixture convenience.

### Required evidence chain

For each applicable transaction:

```text
protocol event
  -> normalized object change
  -> lifecycle event where applicable
  -> balance history where applicable
  -> archive record on deletion
  -> overlay mutation or tombstone
  -> resolved current read result
```

### Assertions

- transaction hash and ledger identity match across related evidence;
- before/after values reconcile;
- lifecycle status transitions reconcile with current or archived outcome;
- deletion removes current object and preserves archive/history;
- source/provenance identity remains traceable.

## F12 — Asset-separated aggregate inputs

### Purpose

Prove consolidated fixtures never combine unlike canonical assets.

### Setup

Create deterministic subjects for:

- XRP;
- IOU USD issuer A;
- IOU USD issuer B;
- MPT issuance A.

Use overlapping human-readable symbols where useful to catch symbol-based grouping mistakes.

### Assertions

- grouping key is canonical asset key;
- IOU issuer A and issuer B remain separate;
- MPT remains separate from XRP/IOU;
- aggregate helper rejects or separates unlike keys according to production contract;
- no fixture produces one global numeric total.

## F13 — Count reconciliation base plus overlay deltas

### Purpose

Provide shared count evidence for M6-I1 and later M6-I5 reconciliation.

### Setup

For each object type, include a controlled mixture of:

- base-only current;
- base modified by overlay;
- overlay-created current;
- base deleted by tombstone;
- overlay-created then deleted.

### Expected formula

For exact fixture contexts where each delta is known:

```text
resolved current count
=
base count
+ post-base created-current delta
- base-deleted delta
```

An overlay-created-then-deleted object contributes net zero to final current count.

### Assertions

- modified base object does not change count;
- duplicate base/overlay identity is counted once;
- tombstoned base object is excluded;
- created-then-deleted object is excluded;
- per-object-type and all-current totals reconcile;
- counts stay network/epoch/base scoped.

## F14 — Provenance and source identity matrix

### Purpose

Make provenance assertions reusable instead of scattered.

### Required subjects

At minimum:

- base-only current object;
- overlay current object;
- derived schedule status;
- derived Vault or Broker metric;
- indexed Activity event;
- indexed object change;
- indexed lifecycle event;
- archived object;
- unavailable value/state.

### Assertions

Each subject records:

- provenance category;
- network;
- epoch;
- base snapshot where relevant;
- source ledger;
- source transaction where relevant;
- formula identifier where derived;
- observation-window limitation where indexed.

Do not invent a new public provenance category solely for fixture implementation.

## Fixture declaration shape

Recommended declarative shape:

```ts
interface M6FixtureScenario {
  scenarioId: string
  context: M6FixtureContext
  baseObjects: FixtureObject[]
  canonicalLedgers: FixtureLedger[]
  expectedCurrent: ExpectedCurrentState
  expectedHistory: ExpectedHistoryState
  expectedRelationships: ExpectedRelationshipFinding[]
  expectedCounts: ExpectedCountState
  expectedProvenance: ExpectedProvenanceFinding[]
  expectedOutcome: 'pass' | 'reject' | 'unavailable'
  expectedReason?: string
}
```

This is a documentation shape, not a mandatory new production type. Implementation should adapt to existing repository test support and production types rather than introducing unnecessary abstraction.

## Builder rules

A fixture builder may:

- create valid deterministic identifiers/hashes/accounts;
- generate valid local D1 rows through existing repository APIs or migrations;
- create immutable base artifacts through existing artifact helpers;
- create validated ledger/transaction fixtures through existing collector test support;
- capture before/after evidence snapshots.

A fixture builder must not:

- directly mutate resolved current outputs to make assertions pass;
- bypass migration/schema constraints;
- skip network/epoch/base identity fields;
- fabricate derived values that production code would calculate differently;
- implement separate relationship resolution;
- implement separate overlay precedence;
- mark a scenario passed without reading resulting repository state.

## Reuse map

### M6-I2

Reuse:

- F00 control;
- F03 modified base object;
- F05 created-then-deleted object;
- F11 integrated event sequence;
- common before/after evidence snapshot.

Purpose:

- interruption boundary;
- rollback;
- replay convergence;
- duplicate detection.

### M6-I3

Reuse:

- context identity helpers;
- deterministic ledger/hash identities;
- F06 epoch-separated identity.

Purpose:

- reset-signal classification without implicit merge.

### M6-I4

Reuse:

- CTX_A and CTX_C_NEW_EPOCH;
- F06 same object ID across epochs;
- F09 cross-epoch relationship mismatch;
- provenance/source evidence snapshot.

Purpose:

- old epoch preservation;
- new epoch activation boundary;
- base reuse rejection.

### M6-I5

Reuse:

- F08 valid relationship chain;
- F11 integrated event sequence;
- F12 asset separation;
- F13 count reconciliation;
- F14 provenance/source identity matrix.

Purpose:

- bounded catch-up;
- stale/fresh transition;
- reconciliation.

## M6-I1 implementation order

After the gate opens:

1. inventory and reuse existing test helpers;
2. implement shared valid identifier/context builders only where missing;
3. implement common evidence snapshot reader;
4. implement F00-F05 precedence/current cases;
5. implement F06-F10 isolation/relationship cases;
6. implement F11 integrated evidence chain;
7. implement F12-F14 asset/count/provenance matrices;
8. run existing focused tests unchanged;
9. document actual implementation reuse and deviations;
10. update `implementation-status.md` only from passing evidence.

## Exit criteria

M6-I1 is not complete merely because this catalog exists.

The implementation unit exits only when:

- the reusable fixture code is merged;
- F00-F14 applicable scenarios are implemented or an explicit evidence-backed deviation is accepted;
- the common evidence snapshot reads actual resulting state;
- existing focused tests still pass;
- cross-epoch and cross-base negative cases pass;
- asset separation passes;
- count reconciliation passes;
- provenance/source identity assertions pass;
- later M6-I2 through M6-I5 can reuse the fixtures without duplicating a second fixture model;
- `implementation-status.md` records actual passing evidence.
