# R3D publication and maintenance evidence — 2026-08-01

Status: R3D implementation and validation evidence for PR #1100. R3 remains local and provider-neutral.

## Publication state

Migration `10007_portable_publication_maintenance.sql` adds provider-neutral state for:

- publication candidates;
- ordered publication work identities;
- independently verified publication status;
- publication watermarks;
- bounded maintenance plans and mutations.

Collection watermarks remain in `collector_committed_watermarks`. Publication and maintenance code does not update that table.

## Committed-only selection

The SQLite reference publication adapter selects only committed works for one configured network, epoch, and base identity.

Selection requires:

- the caller publication-watermark work ID to match stored publication state;
- the full committed work sequence to remain contiguous from the configured immutable-base boundary;
- every selected work to retain committed status, committed time, final ledger/hash, payload digest, and semantic counts;
- exact parent-ledger and parent-hash continuity.

A stale watermark request, missing work, gap, or hash mismatch fails closed.

## Immutable candidate

A publication candidate contains:

- complete ordered work identities;
- work payload digests and semantic-count JSON;
- complete committed reference rows and provenance;
- a canonical publication asset;
- a canonical manifest linking the previous publication, work identities, and asset digest;
- SHA-256 asset and manifest digests;
- a publication ID derived from the manifest digest.

Candidate persistence does not advance the publication watermark. Rebuilding the same candidate before watermark advancement converges on the stored candidate identity.

## Independent verification

Verification reopens the stored candidate and independently:

- rebuilds the committed asset from current committed work and rows;
- compares the reopened asset byte for byte;
- verifies canonical asset and manifest JSON;
- recalculates asset and manifest SHA-256 digests;
- verifies the manifest-derived publication ID;
- records verified status and verified time only after every check succeeds.

Tampered candidate state is rejected before publication-watermark advancement.

## Publication watermark

The publication watermark advances only for an independently verified candidate that extends the current publication chain.

Advancement also requires the collection watermark to cover the publication end ledger. Publication advancement does not move or rewrite the collection watermark.

Repeated advancement of the same verified publication is idempotent.

## Bounded maintenance

Maintenance planning requires:

1. independently verified publication status;
2. the verified publication to be the current publication watermark;
3. committed work coverage at or below that publication watermark;
4. an explicit retained-work count;
5. an explicit mutation limit.

The reference plan can compact only:

- `collector_payload_chunks`;
- `collector_commit_chunks`.

It cannot delete collector work, committed candidate rows, collection watermarks, publication candidates, or publication watermarks.

Plans are canonical SHA-256 identities and list deterministic oldest-first mutations. Application verifies the stored plan and publication coverage, applies only planned mutations inside one transaction, marks them applied, and converges to zero additional mutations on replay.

## Conformance evidence

The SQLite suite proves:

- deterministic selection of contiguous committed work;
- candidate persistence without collection or publication watermark movement;
- candidate idempotence;
- independent reopen and verification;
- candidate tamper rejection;
- publication chain enforcement;
- verified-only publication-watermark advancement;
- collection-watermark independence;
- maintenance rejection before publication-watermark advancement;
- bounded mutation selection with retained newest work;
- deletion of only old payload and commit chunks;
- retention of work, committed rows, collection watermark, and publication watermark;
- maintenance replay convergence;
- changed publication and plan identity rejection.

The R3A interface suite was updated for the expanded publication asset, publication watermark, and asynchronous maintenance-plan contract.

## Retained validation

The latest PR #1100 branch passed:

- Actions workflow-surface guard;
- lint;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean local migration sequence, including migrations `10006` and `10007`;
- application build;
- browser smoke.

The same branch also passed a direct local reproduction of lint, type-check, the R3D SQLite suite, and the R3A adapter conformance suite.

## Boundary

R3D performs no remote publication write and changes no public route, legacy reader authority, hosted adapter, provider selection, Queue, Cron, Mainnet flag, recovery state, qualification, or soak state.

R3E is next: export and restore of collection, scheduler, publication, and maintenance state through adapter boundaries; reader fence and cursor behavior after restore; and the parent R3 exit suite.
