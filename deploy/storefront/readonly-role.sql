\set ON_ERROR_STOP on
-- Run only while connected to the restored test DB, as its administrator.
-- A pre-existing role is deliberately an error: this file never changes an existing login.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'elektrikamarket_test_20261029t010219z_2761a73c' THEN
    RAISE EXCEPTION 'Wrong database: refusing grants';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storefront_test_ro') THEN
    RAISE EXCEPTION 'Role already exists: review its privileges separately';
  END IF;
END
$guard$;
CREATE ROLE storefront_test_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
ALTER ROLE storefront_test_ro SET default_transaction_read_only = on;
ALTER ROLE storefront_test_ro SET search_path = public;
ALTER ROLE storefront_test_ro SET statement_timeout = '30s';
ALTER ROLE storefront_test_ro SET idle_in_transaction_session_timeout = '30s';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE elektrikamarket_test_20261029t010219z_2761a73c FROM PUBLIC;
GRANT CONNECT ON DATABASE elektrikamarket_test_20261029t010219z_2761a73c TO storefront_test_ro;
GRANT USAGE ON SCHEMA public TO storefront_test_ro;
GRANT SELECT ON TABLE
  public.products, public.brands, public.categories,
  public.product_images, public.product_documents,
  public.product_commercial_data, public.product_prices, public.product_stocks,
  public.warehouses, public.shop_settings,
  public.import_issues, public.import_files, public.import_runs
TO storefront_test_ro;
COMMIT;
-- Set a generated SCRAM password separately via psql \password, never in Git or CLI arguments.
-- Do not grant pg_read_all_data, sequence USAGE, schema CREATE or default privileges.
