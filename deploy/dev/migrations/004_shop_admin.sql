CREATE TABLE shop.staff (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.staff_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id bigint NOT NULL REFERENCES shop.staff (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.pages (
  slug text PRIMARY KEY,
  title text NOT NULL,
  body text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shop.orders ADD COLUMN staff_note text;

INSERT INTO shop.staff (email, name, password_hash) VALUES
  ('andronik73@gmail.com', 'Андроник', 'scrypt$XCapu75EffxHADRo7WmIiA$QESQ3rb7YrFDx_eSVRkVbXHBjGiC4ucAWnV_yhIvMG0'),
  ('stron111@gmail.com', 'Сергей', 'scrypt$MfjClVbKB6bW_QTlhMJfNQ$JRhvcy_C0H4nSmFeF081R_Nqf-DR_22Ovn3DLamXAF8');
