\set ON_ERROR_STOP on
-- Apply only under separately authorised deployment, after the additive migration.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'elektrikamarket_test_20261029t010219z_2761a73c' THEN
  RAISE EXCEPTION 'Wrong database: refusing grants';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='storefront_test_ro') THEN
  RAISE EXCEPTION 'Read-only role missing';
 END IF;
END
$guard$;
GRANT SELECT ON public.assortment_snapshots TO storefront_test_ro;
-- Purchase price remains server-only; reader only needs these public columns.
GRANT SELECT ("snapshotId","productId","priceSource","retailPrice",currency,uom,
 "itemsPerUnit","itemsPerUom",multiplicity,"multiplicityRaw",stocks)
 ON public.assortment_items TO storefront_test_ro;
COMMIT;
