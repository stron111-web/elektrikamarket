ALTER TABLE shop.orders ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE shop.orders ALTER COLUMN contact_email DROP NOT NULL;

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
  ADD CONSTRAINT orders_status_check CHECK (status IN ('placed', 'paid', 'sent', 'cancelled'));

ALTER TABLE shop.orders
  ADD COLUMN delivery_kind text NOT NULL DEFAULT 'pickup',
  ADD COLUMN carrier text,
  ADD COLUMN delivery_point text,
  ADD COLUMN comment text,
  ADD COLUMN guest_key text;

ALTER TABLE shop.orders
  ADD CONSTRAINT orders_delivery_kind_check CHECK (delivery_kind IN ('pickup', 'address', 'pvz'));

CREATE INDEX orders_guest_key_idx ON shop.orders (guest_key) WHERE guest_key IS NOT NULL;

CREATE TABLE shop.cart_items (
  buyer_id bigint NOT NULL REFERENCES shop.buyers (id) ON DELETE CASCADE,
  product_id integer NOT NULL,
  supplier_code text NOT NULL,
  quantity numeric(20,10) NOT NULL CHECK (quantity > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, product_id)
);

CREATE TABLE shop.payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  buyer_id bigint REFERENCES shop.buyers (id) ON DELETE CASCADE,
  guest_key text,
  payload jsonb NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  order_id bigint REFERENCES shop.orders (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((buyer_id IS NOT NULL) OR (guest_key IS NOT NULL))
);

CREATE INDEX payments_owner_idx ON shop.payments (status, buyer_id, guest_key);
