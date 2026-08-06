# R4F G2D isolated PostgreSQL persistence and readback

Date: `2026-08-06`.
Issue: `#1261`.

## Purpose

G2D corrects the earlier validation gap: the repository's normal migration step applies D1 migrations, not Supabase PostgreSQL migrations.

This unit runs the revision-4 candidate migration against a disposable local PostgreSQL 15 container. It uses no Supabase account, credential, project, production database, network endpoint, or R5 executor.

## Sequence

1. Generate the deterministic G2C offline shadow evidence.
2. Resolve its exact writer RPC request body.
3. Start a disposable `postgres:15-alpine` container.
4. create the provider-base `anon`, `authenticated`, and `service_role` roles and `extensions` schema;
5. apply only the revision-4 candidate migration;
6. call the writer with the exact offline accounting JSON and digest;
7. replay the same identity and require idempotency;
8. read the evidence through the reader and reconcile checks and count;
9. submit a valid conflicting accounting document with the same observation ID and require `observation_identity_conflict`;
10. verify no public-role schema or RPC privilege leaked;
11. export the candidate schema data and require both tables;
12. destroy the container.

## CI boundary

The harness is `scripts/test-r4f-revision4-directional-persistence-postgres.sh` and runs in the ordinary CI quality job.

It explicitly unsets Supabase credentials. Static tests prohibit Supabase URLs, management API calls, deployment commands, issue writes, and active R5 references.

## Exit interpretation

A passing G2D proves PostgreSQL syntax, extension behavior, migration creation, candidate writer/readback behavior, exact idempotency, conflict rejection, access control, and data export against PostgreSQL 15.

It does not prove Supabase provider deployment, provider egress reporting, G3 reconciliation, memory safety, steady convergence, catch-up convergence, or selection. Revision 4 remains unselected and R5 remains halted.
