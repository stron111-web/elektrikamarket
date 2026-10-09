# PRICAT importer

Node.js 24. Both modes use the same streaming XML/ZIP reader and normalizer.
Raw records are spooled to a temporary NDJSON file; publication uses bounded SQL
batches and one transaction for both sources. No Product creation or migrations.

```powershell
node scripts/import/pricat-import.cjs --database-url-env DATABASE_URL --mode dry-run --pricat1 C:/imports/pricat1.zip --pricat2 C:/imports/pricat2.xml --report scripts/import/reports/issues.ndjson
npm run test:pricat
npm run test:import
```

The default mode is `dry-run`, using a PostgreSQL read-only transaction.
`--mode production` explicitly enables audit and commercial-data writes.
Sources must be specified explicitly. PRICAT1/QTY maps to stock1;
PRICAT2/QTY to stock2; PRICAT1/PartnerQTY to stock3.
PRICAT2/PartnerQTY and SumQTY are retained only in rawData.
Missing quantities and missing codes never clear existing stocks.

RetailPrice is the customer price; when below Price2 it becomes
Price2 × (1 + ShopSettings.protectiveMarkupPercent / 100), rounded half-up
to two decimals. Original supplier fields remain in rawData. CustPrice is
stored without participating in pricing. Arithmetic uses exact decimal values.
Multiplicity stores both a nullable decimal and its original string.

Conflicting codes are quarantined per source, all raw variants go to ImportIssue.
Uncertain supplier quantities become NULL with previous values retained in audit.
Manual/locked data are preserved. Read sellable stocks through
`readAvailableStocks`; direct `quantity > 0` is insufficient. The projection
checks quarantine, positive prices, RUB currencies and compatible price/stock
UOM. It cannot convert partner units. No stock quantity totals across UOM.

When an existing supplier stock disagrees with the incoming warehouse UOM,
`STOCK_UOM_CONFLICT` excludes that warehouse even if another PRICAT or a manual
price could price its old units. The stored stock is preserved, including locks.
A later successfully published matching observation writes `STOCK_UOM_CONFIRMED`
and restores eligibility; absent quantities, skipped files and rolled-back runs
do not clear the conflict. Use `--reprocess true` to reconsider a previously
imported file. Manual stock overrides are not reinterpreted by supplier records.

If a price is locked (including Product.lockedFields), a change of UOM,
ItemsPerUOM or ItemsPerUnit preserves its entire existing commercial context.
Compatible commercial updates remain possible. Unlocking allows price and
commercial units to update together on the next publication.

`readStorefrontPrices(db, supplierCodes)` centrally selects one product price:
valid MANUAL first, then PRICAT2, then PRICAT1. Price selection is independent of
warehouse quantities: zero stock2 does not change the PRICAT2 price priority.
Invalid and quarantined commercial price sources are excluded. The protective
rule uses only Price2 of the selected price source, not costs from other warehouses.
`readSaleOffers(db, supplierCodes)` returns that one price with all sellable
stock1/stock2/stock3 rows having compatible UOM and no source quarantine.
No minimum/maximum selection or warehouse-specific sale price is supported.
The read projection applies
the current protective percent without modifying stored manual/locked values.
It recalculates an unlocked imported protected price from its original raw
RetailPrice, so a settings change is reflected before the next import.

SHA-256 prevents repeat publication; settings changes invalidate the cache.
`--reprocess true` rechecks matches after PRODAT additions or unlocking.
Older snapshots remain rejected. A session advisory lock excludes concurrent
importers. Interrupted runs are marked FAILED after acquiring that lock;
retry validates and atomically republishes. File mutations and changes of
settings/warehouses during validation are rejected.

Tests create randomly named, isolated PostgreSQL databases using
PRICAT_TEST_ADMIN_URL (or DATABASE_URL solely as the cluster administration
connection). They apply existing migrations inside the temporary database and
remove only that generated database afterward. Importer tests never write to
the database named by DATABASE_URL.

Real supplier XML/ZIP, raw diagnostics and reports containing actual supplier
codes or commercial terms remain local and are excluded from Git.
