# Test catalogue, issue 5, 19 November 2026

Only the Test web image changes. Preview, demo, database schema/data, importers and schedules are outside this release.

The home page has a framed category panel and real category links. Category menus have at most two columns (one on narrow screens), with groups flowing vertically inside each column. Category names are clamped to two lines; full names remain in accessible text/title attributes.

Leaf categories replace the category tree with server-side filters: actual category brands, published retail price bounds, and permitted positive warehouse stock. Options and products come from the active assortment snapshot, never from raw stock or purchase-price tables. Filters compose before count and pagination. URLs preserve filters across pages; resetting preserves the category. Prices are parsed as bounded decimal strings, with comma input accepted. Invalid input cannot inject SQL or choose arbitrary warehouse identifiers. An inverted price interval returns no matches.

## Verified reads, snapshot 12

For `lampy-svetodiodnye`: 2,951 offers and 34 brands; retail range 25.62–20,362.41 RUB. Stock1: 783, stock2: 1,042, stock3: 2,388 (warehouses overlap).

Price <=100: 834; price >=100: 2,117; IEK: 124; price 50–200 plus stock1: 574; adding IEK: 55. Independent SELECT counts matched the reader. Unfiltered items exactly matched the previous reader. Page 1/2 kept the same count and had no duplicate items. A representative count plan used category/product and assortment primary-key indices, about 18.5 ms, with no temporary files or written buffers.

Three small unit tests cover input bounds, warehouse validation and URL pagination. No new database, database fixture, import, snapshot rebuild, grants or migration was executed.

## ETIM remains blocked by read permissions

Runtime role `storefront_test_ro` lacks SELECT on **each** of the five required columns of `public.product_features`: `productId`, `featureCode`, `featureName`, `featureValue`, `featureUom`. Table-level SELECT is also absent. No decorative ETIM controls are rendered, and no grants were applied.

For a separately authorized next step, an administrator could grant only these read columns (not INSERT/UPDATE/DELETE and not all tables):

```sql
GRANT SELECT ("productId", "featureCode", "featureName", "featureValue", "featureUom")
ON public.product_features TO storefront_test_ro;
```

This SQL is a proposal, **not an executed installation step**. After authorization, read actual values in selected leaf categories; implement code/name/unit-aware facets and parameterized EXISTS conditions before pagination, then verify counts and plans using only SELECT. Do not invent attribute choices or change manual/locked feature data.

The existing Next.js 16.4.0 security warning remains a separate dependency-security task; no dependencies were changed here.

## Quick sorting and Preview banner, follow-up

The horizontal bar is separate from detailed filters, on product listings including search, all accepted offers and explicit intermediate-category listings. No bar on the banner home or category-only navigation. Six allowlisted sort modes apply in PostgreSQL before LIMIT/OFFSET; product ID breaks ties. Price uses the snapshot numeric retail price. Brand uses case-insensitive names, Ё normalized to Е, database alphabetical collation, missing brands last. Quick brand and detailed brand share the URL value. Sorting, search, price and warehouse survive pagination and form submissions; applying controls resets the page.

Quantity means the snapshot-approved stock of the selected warehouse, or the sum of available warehouse stocks **only in the offer UOM**. No package splitting or conversions. Different sale units (e.g. PCE, NMP, MTR) form separate UOM groups, then quantities sort inside each group, in either direction. This is explicitly explained next to quantity sorting; it does not claim that a metre equals a piece. Cards show the selected-scope quantity and its sale unit.

Read-only checks compared 48 items (pages 1 and 2) for each of six sorts with independent ordered SELECTs against snapshot 12, all passed without duplicates. LED price ascending begins 25.62 RUB (codes 417257, 495469), descending 20362.41 RUB (1850016). Combining IEK, 50–200 RUB, stock1 and search лампа leaves 55 offers; quantity descending has 142 at the end of page 1 and 140 at the start of page 2. Four short URL/input unit tests passed. No database writes or schema/permission changes.

Home reuses the exact existing `web/public/brand/petrovich.jpg` from Preview revision 45489f5, without editing/generation. It is a noninteractive banner because Test has no estimate-upload route; no broken `/estimate` link is introduced. Left category links remain real category URLs, in a green framed panel. Category group boxes remain at most two columns with individual borders.
