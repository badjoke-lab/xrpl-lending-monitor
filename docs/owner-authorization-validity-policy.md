# OWNER authorization validity policy

## Purpose

OWNER authorization must remain safe without turning short wall-clock deadlines into an operational dependency. The project may be unattended for long periods. Normal runtime, read-only qualification, evidence gathering, and repository work must not stop merely because an unused mutation proposal is old.

## Default rule

For a bounded production mutation that is already protected by an exact immutable bundle, deterministic prestate digest, apply-time preflight, one-shot semantics, and rollback-on-mismatch, OWNER authorization is **state-bound, not wall-clock-bound**.

The authorization remains eligible only while all of the following remain true:

- the exact OWNER command matches the reviewed execution commit, bundle digest, project identity, prepare run, prestate digest, and nonce;
- the exact prestate and every apply-time fingerprint/preflight requirement still match immediately before mutation;
- the exact bundle has not already been successfully applied;
- no replacement authorization for the same mutation boundary has superseded it;
- no explicit revocation has been recorded.

Any prestate, hash, fingerprint, schema-shape, identity, or one-shot mismatch fails closed before mutation. A stale authorization is therefore rejected because the state no longer matches, not because an arbitrary clock deadline elapsed.

## Wall-clock expiry

A wall-clock expiry is not required by default and must not be introduced merely to make a prepare artifact look fresh. If a future mutation has a genuine time-sensitive risk that is not already captured by state/preflight checks, a finite expiry may be added only with a documented reason specific to that mutation.

## OWNER absence

OWNER absence must not create a recurring maintenance deadline.

While OWNER input is unavailable:

- existing production runtime may continue under its already-authorized guards;
- read-only production probes and independent verification may continue;
- repository-only implementation, tests, documentation, and evidence preparation may continue;
- unapproved production mutation remains paused;
- expired or stale proposals must never be presented as a site outage or as a reason normal authorized runtime cannot operate;
- destructive cleanup, scheduler changes, public-reader changes, R5 rearm/restart, and Mainnet remain separately authorized when their existing contracts require it.

## Replay and stale-state protection

Wall-clock expiry is not the replay barrier. Replay and stale-state protection must come from durable state:

1. exact bundle digest;
2. exact deterministic prestate digest;
3. exact apply-time fingerprints and schema preconditions;
4. nonce-bound exact OWNER command;
5. one successful bounded transaction only;
6. fail-closed rollback on any mismatch;
7. independent read-only verification after apply.

If the prepared state changes while the OWNER is away, a future apply must fail closed and a fresh read-only prepare may be generated without requiring the OWNER to race a short deadline.
