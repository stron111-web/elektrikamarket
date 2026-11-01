BEGIN;
SELECT set_config('preview_shop.approved_tables', :'approved_tables', true);
DO $grant$
DECLARE t text; obj oid; s record;
BEGIN
 IF current_database() <> 'elektrikamarket_preview_shop' THEN RAISE EXCEPTION 'wrong database'; END IF;
 IF jsonb_typeof(current_setting('preview_shop.approved_tables')::jsonb) <> 'array' THEN RAISE EXCEPTION 'expected JSON array'; END IF;
 FOR t IN SELECT jsonb_array_elements_text(current_setting('preview_shop.approved_tables')::jsonb) LOOP
  IF t LIKE '\_%' ESCAPE '\' THEN RAISE EXCEPTION 'service tables excluded'; END IF;
  SELECT c.oid INTO obj FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='shop' AND c.relname=t AND c.relkind IN ('r','p') AND c.relowner='storefront_preview_shop_migrator'::regrole;
  IF obj IS NULL THEN RAISE EXCEPTION 'table absent or wrong owner'; END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE shop.%I TO storefront_preview_shop_app',t);
  FOR s IN SELECT DISTINCT ns.nspname,c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_depend d ON d.objid=c.oid AND d.classid='pg_class'::regclass WHERE c.relkind='S' AND d.refobjid=obj AND d.deptype IN ('a','i') AND ns.nspname='shop' LOOP
   EXECUTE format('GRANT USAGE ON SEQUENCE %I.%I TO storefront_preview_shop_app',s.nspname,s.relname);
  END LOOP;
 END LOOP;
END
$grant$;
COMMIT;
