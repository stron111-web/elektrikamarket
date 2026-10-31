-- Only two storage structures: generation metadata and compact commercial offers.
CREATE TABLE "assortment_snapshots" (
  id BIGSERIAL PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importRunId" INTEGER REFERENCES import_runs(id) ON DELETE RESTRICT,
  "pricat1FileId" INTEGER NOT NULL REFERENCES import_files(id) ON DELETE RESTRICT,
  "pricat2FileId" INTEGER NOT NULL REFERENCES import_files(id) ON DELETE RESTRICT,
  "projectionVersion" TEXT NOT NULL,
  "protectiveMarkupPercent" NUMERIC(7,3) NOT NULL CHECK ("protectiveMarkupPercent" >= 0),
  "productCount" INTEGER NOT NULL DEFAULT 0 CHECK ("productCount" >= 0)
);
-- At most one published generation. A transaction flips old/new atomically under MVCC.
CREATE UNIQUE INDEX assortment_snapshots_one_active ON assortment_snapshots(active) WHERE active;
CREATE TABLE "assortment_items" (
  "snapshotId" BIGINT NOT NULL REFERENCES assortment_snapshots(id) ON DELETE CASCADE,
  "productId" INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  "priceSource" "CommercialSource" NOT NULL,
  "retailPrice" NUMERIC(14,2) NOT NULL CHECK ("retailPrice" > 0),
  "purchasePrice" NUMERIC(14,2),
  currency TEXT NOT NULL CHECK (currency = 'RUB'),
  uom TEXT NOT NULL CHECK (length(uom) > 0),
  "itemsPerUnit" NUMERIC(20,10),
  "itemsPerUom" TEXT,
  multiplicity NUMERIC(20,10),
  "multiplicityRaw" TEXT,
  stocks JSONB NOT NULL CHECK (jsonb_typeof(stocks) = 'array' AND jsonb_array_length(stocks) BETWEEN 1 AND 3),
  PRIMARY KEY ("snapshotId","productId")
);
