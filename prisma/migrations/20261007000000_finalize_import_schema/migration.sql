-- CreateEnum
CREATE TYPE "DataOrigin" AS ENUM ('PRODAT', 'MANUAL');

-- CreateEnum
CREATE TYPE "CommercialSource" AS ENUM ('PRICAT1', 'PRICAT2', 'MANUAL');

-- CreateEnum
CREATE TYPE "QuantityField" AS ENUM ('QTY', 'PARTNER_QTY', 'MANUAL');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('PRODAT', 'PRICAT');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('PRODAT', 'PRICAT1', 'PRICAT2');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('WARNING', 'ERROR');

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_parentId_fkey";

-- DropForeignKey
ALTER TABLE "product_barcodes" DROP CONSTRAINT "product_barcodes_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_documents" DROP CONSTRAINT "product_documents_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_features" DROP CONSTRAINT "product_features_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_prices" DROP CONSTRAINT "product_prices_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_relations" DROP CONSTRAINT "product_relations_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_relations" DROP CONSTRAINT "product_relations_relatedId_fkey";

-- DropForeignKey
ALTER TABLE "product_stocks" DROP CONSTRAINT "product_stocks_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_stocks" DROP CONSTRAINT "product_stocks_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_brandId_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_categoryId_fkey";

-- DropIndex
DROP INDEX "product_documents_productId_idx";

-- DropIndex
DROP INDEX "product_features_productId_idx";

-- DropIndex
DROP INDEX "product_images_productId_idx";

-- DropIndex
DROP INDEX "product_prices_productId_idx";

-- DropIndex
DROP INDEX "product_relations_productId_idx";

-- DropIndex
DROP INDEX "product_relations_productId_relatedId_relationType_key";

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sourceKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "product_barcodes" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origin" "DataOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "product_documents" ADD COLUMN     "certificateType" TEXT,
ADD COLUMN     "identityKey" CHAR(64) NOT NULL,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origin" "DataOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "product_features" ADD COLUMN     "identityKey" CHAR(64) NOT NULL,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origin" "DataOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origin" "DataOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "urlKey" CHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE "product_prices" DROP COLUMN "productId",
ADD COLUMN     "availabilityMrc" TEXT,
ADD COLUMN     "commercialDataId" INTEGER NOT NULL,
ADD COLUMN     "importFileId" INTEGER,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rawData" JSONB,
ADD COLUMN     "retailCurrency" TEXT;

-- AlterTable
ALTER TABLE "product_relations" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origin" "DataOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "targetSupplierCode" TEXT NOT NULL,
ALTER COLUMN "relatedId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "product_stocks" ADD COLUMN     "estimatedArrivalDate" DATE,
ADD COLUMN     "importFileId" INTEGER,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quantityField" "QuantityField" NOT NULL,
ADD COLUMN     "quantityRaw" TEXT,
ADD COLUMN     "source" "CommercialSource" NOT NULL,
ADD COLUMN     "sourceUpdatedDate" DATE,
ADD COLUMN     "uom" TEXT,
ALTER COLUMN "quantity" DROP NOT NULL,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(20,8);

-- AlterTable
ALTER TABLE "products" DROP COLUMN "analitCat",
DROP COLUMN "blockExpAll",
DROP COLUMN "blockExpBy",
DROP COLUMN "blockExpKz",
DROP COLUMN "country",
DROP COLUMN "estimatedArrivalDate",
DROP COLUMN "lastPricatUpdate",
DROP COLUMN "multiplicity",
ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "depth" DECIMAL(20,10),
ADD COLUMN     "dimensionUnit" TEXT,
ADD COLUMN     "gost" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "height" DECIMAL(20,10),
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastProdatAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastProdatFileId" INTEGER,
ADD COLUMN     "lockedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "physicalRaw" JSONB,
ADD COLUMN     "series" TEXT,
ADD COLUMN     "ty" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "weight" DECIMAL(20,10),
ADD COLUMN     "weightUnit" TEXT,
ADD COLUMN     "width" DECIMAL(20,10),
ALTER COLUMN "itemsPerUnit" SET DATA TYPE DECIMAL(20,10),
ALTER COLUMN "itemsPerUom" SET DATA TYPE TEXT,
ALTER COLUMN "labelledItemChz" SET DATA TYPE TEXT,
DROP COLUMN "rsCatalog",
ADD COLUMN     "rsCatalog" JSONB;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_commercial_data" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "source" "CommercialSource" NOT NULL,
    "multiplicity" DECIMAL(20,10),
    "multiplicityRaw" TEXT,
    "itemsPerUnit" DECIMAL(20,10),
    "itemsPerUom" TEXT,
    "uom" TEXT,
    "analitCat" TEXT,
    "mark" TEXT,
    "blockExpAll" BOOLEAN,
    "blockExpBy" BOOLEAN,
    "blockExpKz" BOOLEAN,
    "rawData" JSONB,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "importFileId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_commercial_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" SERIAL NOT NULL,
    "type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "importerVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "createdRecords" INTEGER NOT NULL DEFAULT 0,
    "updatedRecords" INTEGER NOT NULL DEFAULT 0,
    "skippedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "diagnostics" JSONB,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_files" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT NOT NULL,
    "sourceUri" TEXT,
    "storageKey" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "documentNumber" TEXT,
    "documentDate" TIMESTAMP(0),
    "documentDateRaw" TEXT,
    "remoteModified" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "message" TEXT,

    CONSTRAINT "import_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_issues" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "fileId" INTEGER,
    "severity" "IssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "supplierCode" TEXT,
    "recordNumber" INTEGER,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "protectiveMarkupPercent" DECIMAL(7,3) NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_commercial_data_importFileId_idx" ON "product_commercial_data"("importFileId");

-- CreateIndex
CREATE UNIQUE INDEX "product_commercial_data_productId_source_key" ON "product_commercial_data"("productId", "source");

-- CreateIndex
CREATE INDEX "import_runs_type_startedAt_idx" ON "import_runs"("type", "startedAt");

-- CreateIndex
CREATE INDEX "import_runs_status_startedAt_idx" ON "import_runs"("status", "startedAt");

-- CreateIndex
CREATE INDEX "import_files_runId_idx" ON "import_files"("runId");

-- CreateIndex
CREATE INDEX "import_files_source_sha256_status_idx" ON "import_files"("source", "sha256", "status");

-- CreateIndex
CREATE INDEX "import_issues_runId_severity_idx" ON "import_issues"("runId", "severity");

-- CreateIndex
CREATE INDEX "import_issues_fileId_idx" ON "import_issues"("fileId");

-- CreateIndex
CREATE INDEX "import_issues_supplierCode_idx" ON "import_issues"("supplierCode");

-- CreateIndex
CREATE UNIQUE INDEX "categories_sourceKey_key" ON "categories"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "product_documents_productId_identityKey_key" ON "product_documents"("productId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "product_features_productId_identityKey_key" ON "product_features"("productId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_productId_urlKey_key" ON "product_images"("productId", "urlKey");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_commercialDataId_key" ON "product_prices"("commercialDataId");

-- CreateIndex
CREATE INDEX "product_prices_importFileId_idx" ON "product_prices"("importFileId");

-- CreateIndex
CREATE INDEX "product_relations_targetSupplierCode_idx" ON "product_relations"("targetSupplierCode");

-- CreateIndex
CREATE UNIQUE INDEX "product_relations_productId_targetSupplierCode_relationType_key" ON "product_relations"("productId", "targetSupplierCode", "relationType");

-- CreateIndex
CREATE INDEX "product_stocks_importFileId_idx" ON "product_stocks"("importFileId");

-- CreateIndex
CREATE INDEX "products_lastProdatFileId_idx" ON "products"("lastProdatFileId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_lastProdatFileId_fkey" FOREIGN KEY ("lastProdatFileId") REFERENCES "import_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_relatedId_fkey" FOREIGN KEY ("relatedId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_commercial_data" ADD CONSTRAINT "product_commercial_data_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_commercial_data" ADD CONSTRAINT "product_commercial_data_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "import_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_commercialDataId_fkey" FOREIGN KEY ("commercialDataId") REFERENCES "product_commercial_data"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "import_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "import_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_runId_fkey" FOREIGN KEY ("runId") REFERENCES "import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_issues" ADD CONSTRAINT "import_issues_runId_fkey" FOREIGN KEY ("runId") REFERENCES "import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_issues" ADD CONSTRAINT "import_issues_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "import_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ShopSettings singleton and non-negative protective markup.
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_protective_markup_check" CHECK ("protectiveMarkupPercent" >= 0);
