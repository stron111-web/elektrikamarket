CREATE TABLE shop.buyers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  phone text NOT NULL,
  password_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('individual', 'organization')),
  status text NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'discount')),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'regular' AND discount_percent = 0)
    OR (status = 'discount' AND discount_percent > 0 AND discount_percent <= 100)
  )
);

CREATE TABLE shop.individual_profiles (
  buyer_id bigint PRIMARY KEY REFERENCES shop.buyers (id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text
);

CREATE TABLE shop.organizations (
  buyer_id bigint PRIMARY KEY REFERENCES shop.buyers (id) ON DELETE CASCADE,
  inn text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_address text NOT NULL,
  kpp text NOT NULL,
  ogrn text NOT NULL,
  contact_name text NOT NULL
);

CREATE TABLE shop.sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id bigint NOT NULL REFERENCES shop.buyers (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.favorites (
  buyer_id bigint NOT NULL REFERENCES shop.buyers (id) ON DELETE CASCADE,
  product_id integer NOT NULL,
  supplier_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, product_id)
);

CREATE TABLE shop.comparisons (
  buyer_id bigint NOT NULL REFERENCES shop.buyers (id) ON DELETE CASCADE,
  product_id integer NOT NULL,
  supplier_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, product_id)
);

CREATE TABLE shop.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id bigint NOT NULL REFERENCES shop.buyers (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'sent', 'cancelled')),
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  contact_email text NOT NULL,
  organization_name text,
  organization_inn text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES shop.orders (id) ON DELETE CASCADE,
  product_id integer NOT NULL,
  supplier_code text NOT NULL,
  name text NOT NULL,
  uom text NOT NULL,
  quantity numeric(20,10) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX orders_buyer_idx ON shop.orders (buyer_id, id DESC);
