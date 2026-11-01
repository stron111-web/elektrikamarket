CREATE OR REPLACE FUNCTION public.buyer_markup_price(product_ids integer[], percent numeric)
RETURNS TABLE (product_id integer, price numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i."productId",
    CASE
      WHEN percent IS NULL OR percent <= 0 OR percent > 1000 OR i."purchasePrice" IS NULL OR i."purchasePrice" <= 0 THEN NULL
      ELSE round(i."purchasePrice" * (100 + percent) / 100, 2)
    END
  FROM assortment_items i
  JOIN assortment_snapshots s ON s.id = i."snapshotId" AND s.active
  WHERE i."productId" = ANY (product_ids);
$$;

REVOKE ALL ON FUNCTION public.buyer_markup_price(integer[], numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buyer_markup_price(integer[], numeric) TO storefront_preview_ro;
