/*
  Warnings:

  - You are about to drop the column `brand` on the `products` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[slug]` on the table `products` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slug` to the `products` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "products_brand_idx";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "brand",
ADD COLUMN     "analitCat" TEXT,
ADD COLUMN     "blockExpAll" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockExpBy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockExpKz" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "brandId" INTEGER,
ADD COLUMN     "categoryId" INTEGER,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "estimatedArrivalDate" TIMESTAMP(3),
ADD COLUMN     "guaranteePeriod" TEXT,
ADD COLUMN     "itemId" INTEGER,
ADD COLUMN     "itemsPerUnit" DECIMAL(12,3),
ADD COLUMN     "itemsPerUom" DECIMAL(12,3),
ADD COLUMN     "labelledItemChz" BOOLEAN,
ADD COLUMN     "lastPricatUpdate" TIMESTAMP(3),
ADD COLUMN     "minprom" TEXT,
ADD COLUMN     "multiplicity" DECIMAL(12,3),
ADD COLUMN     "okpd2" TEXT,
ADD COLUMN     "parentProdCode" TEXT,
ADD COLUMN     "parentProdGroup" TEXT,
ADD COLUMN     "productCode" TEXT,
ADD COLUMN     "productGroup" TEXT,
ADD COLUMN     "productGroupChz" TEXT,
ADD COLUMN     "receiverCode" TEXT,
ADD COLUMN     "rsCatalog" TEXT,
ADD COLUMN     "slug" TEXT NOT NULL,
ADD COLUMN     "tnved" TEXT,
ADD COLUMN     "uom" TEXT;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" INTEGER,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "barcode" TEXT NOT NULL,
    "type" TEXT,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_features" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "featureCode" TEXT,
    "featureName" TEXT NOT NULL,
    "featureValue" TEXT NOT NULL,
    "featureUom" TEXT,

    CONSTRAINT "product_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "alt" TEXT,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_documents" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "product_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_relations" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "relatedId" INTEGER NOT NULL,
    "relationType" TEXT NOT NULL,

    CONSTRAINT "product_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "retailPrice" DECIMAL(14,2),
    "custPrice" DECIMAL(14,2),
    "price2" DECIMAL(14,2),
    "mrc" DECIMAL(14,2),
    "bsp" DECIMAL(14,2),
    "currency" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_name_idx" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE INDEX "product_barcodes_barcode_idx" ON "product_barcodes"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_productId_barcode_key" ON "product_barcodes"("productId", "barcode");

-- CreateIndex
CREATE INDEX "product_features_productId_idx" ON "product_features"("productId");

-- CreateIndex
CREATE INDEX "product_features_featureCode_idx" ON "product_features"("featureCode");

-- CreateIndex
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");

-- CreateIndex
CREATE INDEX "product_documents_productId_idx" ON "product_documents"("productId");

-- CreateIndex
CREATE INDEX "product_relations_productId_idx" ON "product_relations"("productId");

-- CreateIndex
CREATE INDEX "product_relations_relatedId_idx" ON "product_relations"("relatedId");

-- CreateIndex
CREATE UNIQUE INDEX "product_relations_productId_relatedId_relationType_key" ON "product_relations"("productId", "relatedId", "relationType");

-- CreateIndex
CREATE INDEX "product_prices_productId_idx" ON "product_prices"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_brandId_idx" ON "products"("brandId");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_vendorNumber_idx" ON "products"("vendorNumber");

-- CreateIndex
CREATE INDEX "products_productCode_idx" ON "products"("productCode");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_relatedId_fkey" FOREIGN KEY ("relatedId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
