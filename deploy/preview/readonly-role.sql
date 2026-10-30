\set ON_ERROR_STOP on
-- Owner-only, one-time operation AFTER separate approval. Never invoked by CI.
-- Creates only a dedicated preview login and SELECT grants, not schemas/data/migrations.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'elektrikamarket_test_20261029t010219z_2761a73c' THEN
  RAISE EXCEPTION 'Wrong database';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='storefront_preview_ro') THEN
  RAISE EXCEPTION 'Preview role already exists; inspect instead of overwriting';
 END IF;
END
$guard$;
CREATE ROLE storefront_preview_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
 NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
ALTER ROLE storefront_preview_ro SET default_transaction_read_only=on;
ALTER ROLE storefront_preview_ro SET search_path=public;
ALTER ROLE storefront_preview_ro SET statement_timeout='30s';
ALTER ROLE storefront_preview_ro SET idle_in_transaction_session_timeout='30s';
GRANT CONNECT ON DATABASE elektrikamarket_test_20261029t010219z_2761a73c TO storefront_preview_ro;
GRANT USAGE ON SCHEMA public TO storefront_preview_ro;
GRANT SELECT ON public.products,public.brands,public.categories,
 public.product_images,public.product_documents,public.product_commercial_data,
 public.product_prices,public.product_stocks,public.warehouses,public.shop_settings,
 public.import_issues,public.import_files,public.import_runs TO storefront_preview_ro;
DO $check$
BEGIN
 IF has_database_privilege('storefront_preview_ro',current_database(),'CREATE,TEMP')
  OR has_schema_privilege('storefront_preview_ro','public','CREATE') THEN
  RAISE EXCEPTION 'Unexpected inherited PUBLIC write privileges; owner review required';
 END IF;
END
$check$;
COMMIT;
-- Set a separate generated SCRAM password interactively with psql \password.
-- Never reuse the test site's DB password or change PUBLIC/other roles to fix errors.
