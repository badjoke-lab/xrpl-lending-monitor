# D1 migrations

Numbered D1 migrations will be added here beginning with the network and epoch foundation milestone.

Rules:

- migrations are append-only after merge;
- every migration must apply to an empty local database;
- every migration must be tested from the previous schema;
- canonical tables must include network and epoch identity;
- production database IDs and secrets are never committed;
- the placeholder database ID in `wrangler.jsonc` blocks accidental production use until a D1 database is explicitly provisioned.
