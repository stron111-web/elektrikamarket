\set ON_ERROR_STOP on
-- Owner-only upgrade of the existing preview role; never run by CI.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'elektrikamarket_test_20261029t010219z_2761a73c' THEN
  RAISE EXCEPTION 'Wrong database: refusing preview snapshot grants';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='storefront_preview_ro') THEN
  RAISE EXCEPTION 'Existing preview read-only role missing';
 END IF;
 IF to_regclass('public.assortment_snapshots') IS NULL OR
    to_regclass('public.assortment_items') IS NULL THEN
  RAISE EXCEPTION 'Existing snapshot schema missing; do not bootstrap from preview';
 END IF;
END
$guard$;
GRANT SELECT ON public.assortment_snapshots TO storefront_preview_ro;
GRANT SELECT ("snapshotId","productId","priceSource","retailPrice",currency,uom,
 "itemsPerUnit","itemsPerUom",multiplicity,"multiplicityRaw",stocks)
 ON public.assortment_items TO storefront_preview_ro;
COMMIT;
