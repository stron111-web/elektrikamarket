# Test: ETIM filters (Issue #6, 20 November 2026)

Scope: Test web image only, based on deployed `f5eb5ad`. No imports,
business-data writes, migrations, indices or changes to Preview/demo/cron.

## Database access

The database owner is `elektrika`. The existing ordinary database-owner SQL
connection was verified before applying the owner's explicit authorization:

```sql
GRANT SELECT ("productId", "featureCode", "featureName", "featureValue", "featureUom")
ON public.product_features TO storefront_test_ro;
```

Before: no table or column SELECT on this table. After: exactly these five
columns readable; no table-level SELECT, no INSERT/UPDATE/DELETE/TRUNCATE,
no column writes or administrative role attributes. `id`, `identityKey`,
`isLocked`, `origin`, `sortOrder` remain unreadable by Test. Runtime retains
`default_transaction_read_only=true` and REPEATABLE READ READ ONLY queries.

ACL evidence and the narrow grant rollback are protected on the VPS in
`/home/shopadmin/elektrikamarket-test-etim-20261120/`. Rollback revokes only
these newly added column privileges, not unrelated existing permissions.

## Query and URL semantics

`etim` is a repeated JSON tuple `[featureCode, featureName, featureUom, value]`.
`etimCategory` scopes it to the current leaf category. Pagination, the global
search form and quick controls preserve it. Category navigation drops it.
All selections use SQL parameters and correlated EXISTS before count,
ordering and LIMIT. Different properties are AND; values within a property
are OR. No feature join multiplies product rows. Brand, accepted retail
price, approved warehouse stock, text search and all six sorts still apply.

Code, exact name and unit form the identity; endpoints `с` / `по` and unlike
units remain separate. Whitespace in values is normalized for reading only.
Numeric values are discrete source values: no guessed intervals, decimal
conversion or unit conversion. Existing dubious supplier values (including
zero) are not silently corrected or asserted to be physically valid.

Facets are read only for accepted, nonarchived products of a leaf, using
existing productId index lookups. No all-category scan of 2.3M feature rows
or full feature payload reaches Node/browser. SQL statement timeout: 8s.
At most 12 relevant multivalue properties, 60 frequent options each, plus
actually existing selected options; options are scrollable. Missing URL
values get an explicit notice, never fabricated facet data.
Counts beside options refer to the whole category before other filters.
The actual result count includes all filters. Limits: 8 selected properties,
8 values each, 6000 encoded ETIM characters. UI prevents over-limit selection;
server validates untrusted URLs independently. No ETIM facets for global
search/intermediate categories to avoid mixing unlike properties.

## Read-only evidence, active snapshot 13 (137329 offers)

| Leaf | Offers | With ETIM |
|---|---:|---:|
| LED lamps | 2923 | 2659 |
| Modular breakers | 4632 | 4512 |
| Stationary power cable | 908 | 814 |
| Wall/ceiling luminaires | 6523 | 5200 |

Independent SQL agrees with reader: E27 1151; E27 OR E14 1763;
breakers 16 A 393; cable 2.5 sq.mm 136. Initial full reader times including
facets: 1008/933/294/2785 ms respectively. These are observations, not a load
test or guarantee. Missing ETIM means a product cannot match that property.

## Validation and deployment

Small pure tests: `node --test scripts/storefront/filters.test.cjs scripts/storefront/etim.test.cjs`.
Typecheck and production build use the existing Next.js version; its security
upgrade remains a separate task as requested. Do not run importer DB tests.

Build an immutable Test image, validate through a temporary loopback-only web
container with the same read-only Test role (no new DB/volume), then replace
only Compose service `web`, with `--no-deps --pull never --wait` under the
existing Test deployment lock. Save release.env, Compose and previous image
for web-only rollback. Verify HTTPS/auth, mobile/desktop, unchanged unrelated
container IDs and cron. Never run deploy.sh that also handles Caddy.

To roll back, restore the saved Test release.env and run only service web
with the same Compose flags; use the separately saved narrow REVOKE only
if reverting the ETIM permission is also desired. Do not restore a database
dump or touch importers for a web rollback.

## Follow-up: global search and complete lazy ETIM lists

The header search now submits **only q**, on every route. It never inherits
category, brand, price, warehouse, order, page or ETIM. The sidebar remains
a separate local search preserving its leaf and selected filters.

A read-only audit isolated two issues: old global `ВА47-29 16` returned 23
offers, `ва 47 29 16` and `ва47 29 16` returned zero. The existing vector
contains `-29` for a hyphenated number. The new reader matches the adjacent
model phrase with both positive/negative numeric lexemes, using the same
GIN vector. Only explicit one/two-letter-prefix models with two numeric
groups are recognized; ordinary words and exact supplier-code lookup stay
unchanged. A bare number after a model must occur as a standalone numeric
specification in the name, not a suffix like SIMPLE-mod-16. No DB function
or stored search vector was changed. The four model+16 spellings return 31
accepted offers; the model alone returns 356, including spaced spellings.

The previous 12/60 limits are now **initial pages**, not total availability.
All nonempty properties, including one-value properties, are available:
LED lamps 48, breakers 57 (50 multivalue), cable 38 (32 multivalue). Identity
is still exact code/name/unit. First 12 useful properties are preloaded.
“Показать все характеристики” fetches the remaining property metadata in
12-item pages; no values for these extra properties are fetched until the
property is opened. Property search covers the complete category metadata.
Value search and “Показать остальные значения” use real 60-value SQL pages.
Selected values outside a displayed/search page remain hidden GET inputs
and survive Apply, pagination, ordering and browser history.

GET `/api/catalog/etim` is read-only, validates a leaf category, active
snapshot, exact feature identity, offsets and search length, and returns
400 for invalid input / 409 when the active snapshot changed. No new rights.
Metadata and initial options have a bounded 48-entry process cache, TTL 60s,
keyed by snapshot/category. Counts are category-wide, explicitly labelled.
It caches aggregated facets only, never full product feature rows.

Observed same-snapshot read times before: 1008/933/294ms (previous evidence).
After: cold 1090/1414/389ms; immediate repeated reads 175/173/182ms for lamps,
breakers, cable. These are short observations, not a load test. No indices,
migrations, imports, new databases or changes to importers/cron/Preview.
