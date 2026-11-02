-- PostgreSQL-maintained derived vector; source/commercial values stay unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION public.storefront_search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
 SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
 lower(replace(coalesce(value,''),'ё','е')),
 '([0-9])\s*[кk][аa]\M','\1 ka','g'),
 '([0-9])\s*[аa]\M','\1 a','g'),
 '\m[сc](?=[0-9]|\s+[0-9])','c','g'),
 '([[:alpha:]])([0-9])','\1 \2','g'),
 '([0-9])([[:alpha:]])','\1 \2','g')
$$;
CREATE FUNCTION public.storefront_search_vector(title text, code text, article text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
 SELECT setweight(to_tsvector('pg_catalog.russian',coalesce(title,'')),'B')
 || setweight(to_tsvector('pg_catalog.simple',public.storefront_search_normalize(title)),'C')
 || setweight(to_tsvector('pg_catalog.simple',coalesce(code,'') || ' ' || coalesce(article,'')),'A')
$$;
CREATE FUNCTION public.storefront_search_query(value text, technical boolean) RETURNS tsquery
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
 SELECT CASE WHEN technical THEN
   to_tsquery('pg_catalog.simple',coalesce((SELECT string_agg(quote_literal(w),' <-> ' ORDER BY ordinal)
    FROM regexp_split_to_table(public.storefront_search_normalize(value),'[^[:alnum:]]+') WITH ORDINALITY x(w,ordinal) WHERE w<>''),''))
 ELSE to_tsquery('pg_catalog.russian',quote_literal(value) || ':*') END
$$;
ALTER TABLE public.products ADD COLUMN "searchVector" tsvector
 GENERATED ALWAYS AS (public.storefront_search_vector(name,"supplierCode","vendorNumber")) STORED;
CREATE INDEX products_storefront_fts_gin ON public.products USING GIN ("searchVector");
COMMIT;
