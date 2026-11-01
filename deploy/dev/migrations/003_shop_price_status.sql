ALTER TABLE shop.buyers ADD COLUMN markup_percent numeric(7,2) NOT NULL DEFAULT 0;
ALTER TABLE shop.organizations ALTER COLUMN kpp DROP NOT NULL;

DO $$
DECLARE c name;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'shop.buyers'::regclass
      AND con.contype = 'c'
      AND (
        pg_get_constraintdef(con.oid) ILIKE '%status%'
        OR pg_get_constraintdef(con.oid) ILIKE '%discount_percent%'
        OR pg_get_constraintdef(con.oid) ILIKE '%kind%'
      )
  LOOP
    EXECUTE format('ALTER TABLE shop.buyers DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE shop.buyers
  ADD CONSTRAINT buyers_kind_check CHECK (kind IN ('individual', 'organization', 'entrepreneur')),
  ADD CONSTRAINT buyers_status_check CHECK (status IN ('regular', 'discount', 'markup')),
  ADD CONSTRAINT buyers_price_status_check CHECK (
    (status = 'regular' AND discount_percent = 0 AND markup_percent = 0)
    OR (status = 'discount' AND discount_percent > 0 AND discount_percent <= 100 AND markup_percent = 0)
    OR (status = 'markup' AND markup_percent > 0 AND markup_percent <= 1000 AND discount_percent = 0)
  );
