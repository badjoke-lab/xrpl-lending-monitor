# Public discovery and analytics operation

This operation applies only after M1 exit and final public-host selection, except for code preparation that the roadmap explicitly permits during catch-up.

## Configuration boundary

The application accepts two optional build-time variables:

- `VITE_PUBLIC_SITE_ORIGIN` — the exact final public origin, for example an approved HTTPS subdomain. When absent, the UI emits no canonical URL, no `og:url`, and no JSON-LD URL binding. The discovery builder still emits `robots.txt` but does not emit `sitemap.xml`.
- `VITE_GA4_MEASUREMENT_ID` — a real GA4 measurement ID matching the `G-...` form. When absent or invalid, no Google tag script is loaded and no page-view event is sent.

The discovery builder also accepts `PUBLIC_SITE_ORIGIN` as a non-client alias for sitemap and robots generation. Release builds should normally use the same exact origin value for `PUBLIC_SITE_ORIGIN` and `VITE_PUBLIC_SITE_ORIGIN` so HTML canonical output and sitemap URLs cannot diverge.

Placeholder origins, temporary Worker URLs, fake analytics IDs, and verification tokens are prohibited.

## Repository responsibilities

Repository code provides:

- route-specific title, description, robots, Open Graph, and social-card metadata;
- noindex handling for volatile detail routes and unknown routes;
- canonical, `og:url`, and JSON-LD output only after explicit final-origin configuration;
- `robots.txt` generation on every application build;
- `sitemap.xml` generation only when a public origin is configured;
- an optional GA4 loader and SPA page-view hook that remain inactive without valid configuration;
- browser and unit coverage for metadata resolution and absent-configuration safety.

The sitemap contains stable indexable HTML routes only. Volatile object, transaction, account, archived-detail, and epoch-detail routes are intentionally excluded from the sitemap.

## Owner-managed launch tasks

After M1 exit and final public-host approval:

1. configure the Cloudflare public subdomain and confirm HTTPS;
2. provide the exact approved origin to the release build as both `PUBLIC_SITE_ORIGIN` and `VITE_PUBLIC_SITE_ORIGIN`;
3. optionally provide the real `VITE_GA4_MEASUREMENT_ID`;
4. deploy and verify canonical URLs, `robots.txt`, `sitemap.xml`, social metadata, and JSON-LD on the final public host;
5. create or select the Google Search Console property for the final host or domain;
6. complete owner verification through the selected external method;
7. submit the final-host sitemap URL;
8. verify analytics traffic only after the production property is configured;
9. retain Mainnet-disabled and read-only claims in metadata until separately approved.

## Release checks

Before Search Console sitemap submission, verify:

- the collector has reached a healthy fresh head and M1 exit has passed;
- M5-5 real-data integration is complete;
- the production screenshot audit and UI remediation re-audit have passed;
- canonical URLs use only the final approved host;
- no temporary Worker hostname appears in canonical, sitemap, `og:url`, or structured data;
- API and status machine endpoints are not listed in the sitemap;
- analytics is absent when the measurement ID is not configured;
- metadata does not imply Mainnet availability, investment advice, wallet capability, transaction submission, fiat values, rankings, ratings, or unsupported completeness.
