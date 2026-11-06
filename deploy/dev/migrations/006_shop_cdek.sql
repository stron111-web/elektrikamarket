DO $$
DECLARE c name;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'shop.orders'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE shop.orders DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE shop.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN ('placed', 'paid', 'sent', 'cancelled', 'unpaid'));

ALTER TABLE shop.orders
  ADD COLUMN cdek_point_code text,
  ADD COLUMN cdek_city_code integer,
  ADD COLUMN cdek_tariff_code integer,
  ADD COLUMN cdek_tariff_name text,
  ADD COLUMN cdek_tariff_sum numeric(14,2),
  ADD COLUMN cdek_tariff_period text,
  ADD COLUMN cdek_uuid text,
  ADD COLUMN cdek_number text,
  ADD COLUMN cdek_transfer text NOT NULL DEFAULT 'none',
  ADD COLUMN cdek_transfer_at timestamptz,
  ADD COLUMN cdek_error text;

ALTER TABLE shop.orders
  ADD CONSTRAINT orders_cdek_transfer_check CHECK (cdek_transfer IN ('none', 'sending', 'sent', 'failed'));

CREATE UNIQUE INDEX orders_cdek_uuid_idx ON shop.orders (cdek_uuid) WHERE cdek_uuid IS NOT NULL;
