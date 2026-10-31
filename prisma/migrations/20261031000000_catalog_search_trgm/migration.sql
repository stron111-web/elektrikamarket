-- Keep PRODAT text in Product; accelerate the reader's literal, case-insensitive ILIKE.
-- Extension installation requires a separately authorised migration connection, never the web role.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_supplierCode_trgm_idx" ON "products" USING GIN ("supplierCode" gin_trgm_ops);
CREATE INDEX "products_vendorNumber_trgm_idx" ON "products" USING GIN ("vendorNumber" gin_trgm_ops);
