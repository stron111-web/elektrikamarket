CREATE TABLE shop.delivery_preferences (
  buyer_id bigint PRIMARY KEY REFERENCES shop.buyers (id) ON DELETE CASCADE,
  city text NOT NULL,
  city_code integer NOT NULL,
  point_code text,
  point_address text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
