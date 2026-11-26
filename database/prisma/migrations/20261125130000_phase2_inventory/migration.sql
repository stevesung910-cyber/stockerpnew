-- CreateEnum
CREATE TYPE "FinancialYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StockDocumentType" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'RACK', 'SHELF', 'BIN');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FinancialYearStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 6,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HsnCode" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HsnCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstTaxConfiguration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "cgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "igstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "cessRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GstTaxConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "baseUnitId" TEXT NOT NULL,
    "hsnCodeId" TEXT,
    "taxConfigurationId" TEXT,
    "reorderLevel" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemUnitConversion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "factorToBase" DECIMAL(20,6) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ItemUnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "state" TEXT,
    "address" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "state" TEXT,
    "address" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "LocationType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningStockBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "finalizedAt" TIMESTAMP(3),
    "finalizedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningStockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "openingBatchId" TEXT,
    "type" "StockDocumentType" NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "documentNumber" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT,
    "reversalOfId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocumentLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "destinationLocationId" TEXT,
    "enteredQuantity" DECIMAL(20,6) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "conversionFactor" DECIMAL(20,6) NOT NULL,
    "baseQuantity" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,8) NOT NULL,
    "lineValue" DECIMAL(20,2) NOT NULL,
    "hsnSnapshot" TEXT,
    "taxSnapshot" JSONB,

    CONSTRAINT "StockDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedgerEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedBaseQuantity" DECIMAL(20,6) NOT NULL,
    "signedInventoryValue" DECIMAL(20,2) NOT NULL,
    "unitCost" DECIMAL(20,8) NOT NULL,
    "entryType" "StockDocumentType" NOT NULL,
    "reversalOfId" TEXT,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "baseQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "inventoryValue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultDocumentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialYear_companyId_startDate_endDate_idx" ON "FinancialYear"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_id_companyId_key" ON "FinancialYear"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_companyId_code_key" ON "FinancialYear"("companyId", "code");

-- CreateIndex
CREATE INDEX "ItemCategory_companyId_parentId_idx" ON "ItemCategory"("companyId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_id_companyId_key" ON "ItemCategory"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_companyId_code_key" ON "ItemCategory"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_id_companyId_key" ON "UnitOfMeasure"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_companyId_code_key" ON "UnitOfMeasure"("companyId", "code");

-- CreateIndex
CREATE INDEX "HsnCode_companyId_code_active_idx" ON "HsnCode"("companyId", "code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "HsnCode_id_companyId_key" ON "HsnCode"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "HsnCode_companyId_code_effectiveFrom_key" ON "HsnCode"("companyId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "GstTaxConfiguration_companyId_jurisdiction_effectiveFrom_ef_idx" ON "GstTaxConfiguration"("companyId", "jurisdiction", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "GstTaxConfiguration_id_companyId_key" ON "GstTaxConfiguration"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "GstTaxConfiguration_companyId_code_effectiveFrom_key" ON "GstTaxConfiguration"("companyId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Item_companyId_name_idx" ON "Item"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Item_id_companyId_key" ON "Item"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_companyId_code_key" ON "Item"("companyId", "code");

-- CreateIndex
CREATE INDEX "ItemUnitConversion_companyId_itemId_effectiveFrom_effective_idx" ON "ItemUnitConversion"("companyId", "itemId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "ItemUnitConversion_id_companyId_key" ON "ItemUnitConversion"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemUnitConversion_companyId_itemId_unitId_effectiveFrom_key" ON "ItemUnitConversion"("companyId", "itemId", "unitId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Supplier_companyId_name_idx" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_companyId_key" ON "Supplier"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_code_key" ON "Supplier"("companyId", "code");

-- CreateIndex
CREATE INDEX "Customer_companyId_name_idx" ON "Customer"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_companyId_key" ON "Customer"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_code_key" ON "Customer"("companyId", "code");

-- CreateIndex
CREATE INDEX "WarehouseLocation_companyId_warehouseId_parentId_idx" ON "WarehouseLocation"("companyId", "warehouseId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_id_companyId_warehouseId_key" ON "WarehouseLocation"("id", "companyId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_id_companyId_key" ON "WarehouseLocation"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_companyId_warehouseId_code_key" ON "WarehouseLocation"("companyId", "warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningStockBatch_companyId_key" ON "OpeningStockBatch"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningStockBatch_id_companyId_key" ON "OpeningStockBatch"("id", "companyId");

-- CreateIndex
CREATE INDEX "StockDocument_companyId_effectiveDate_status_idx" ON "StockDocument"("companyId", "effectiveDate", "status");

-- CreateIndex
CREATE INDEX "StockDocument_companyId_type_createdAt_idx" ON "StockDocument"("companyId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_id_companyId_key" ON "StockDocument"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_companyId_reversalOfId_key" ON "StockDocument"("companyId", "reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_companyId_documentNumber_key" ON "StockDocument"("companyId", "documentNumber");

-- CreateIndex
CREATE INDEX "StockDocumentLine_companyId_itemId_documentId_idx" ON "StockDocumentLine"("companyId", "itemId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocumentLine_id_companyId_key" ON "StockDocumentLine"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocumentLine_companyId_documentId_lineNumber_key" ON "StockDocumentLine"("companyId", "documentId", "lineNumber");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_companyId_itemId_locationId_effectiveDate__idx" ON "StockLedgerEntry"("companyId", "itemId", "locationId", "effectiveDate", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_companyId_documentId_idx" ON "StockLedgerEntry"("companyId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedgerEntry_id_companyId_key" ON "StockLedgerEntry"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedgerEntry_companyId_documentId_lineId_locationId_key" ON "StockLedgerEntry"("companyId", "documentId", "lineId", "locationId");

-- CreateIndex
CREATE INDEX "StockBalance_companyId_locationId_idx" ON "StockBalance"("companyId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_companyId_itemId_locationId_key" ON "StockBalance"("companyId", "itemId", "locationId");

-- CreateIndex
CREATE INDEX "StockIdempotencyRecord_companyId_resultDocumentId_idx" ON "StockIdempotencyRecord"("companyId", "resultDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockIdempotencyRecord_companyId_operation_key_key" ON "StockIdempotencyRecord"("companyId", "operation", "key");

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_parentId_companyId_fkey" FOREIGN KEY ("parentId", "companyId") REFERENCES "ItemCategory"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOfMeasure" ADD CONSTRAINT "UnitOfMeasure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HsnCode" ADD CONSTRAINT "HsnCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstTaxConfiguration" ADD CONSTRAINT "GstTaxConfiguration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_companyId_fkey" FOREIGN KEY ("categoryId", "companyId") REFERENCES "ItemCategory"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_baseUnitId_companyId_fkey" FOREIGN KEY ("baseUnitId", "companyId") REFERENCES "UnitOfMeasure"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_hsnCodeId_companyId_fkey" FOREIGN KEY ("hsnCodeId", "companyId") REFERENCES "HsnCode"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_taxConfigurationId_companyId_fkey" FOREIGN KEY ("taxConfigurationId", "companyId") REFERENCES "GstTaxConfiguration"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_itemId_companyId_fkey" FOREIGN KEY ("itemId", "companyId") REFERENCES "Item"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_unitId_companyId_fkey" FOREIGN KEY ("unitId", "companyId") REFERENCES "UnitOfMeasure"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_parentId_companyId_warehouseId_fkey" FOREIGN KEY ("parentId", "companyId", "warehouseId") REFERENCES "WarehouseLocation"("id", "companyId", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockBatch" ADD CONSTRAINT "OpeningStockBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_financialYearId_companyId_fkey" FOREIGN KEY ("financialYearId", "companyId") REFERENCES "FinancialYear"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_openingBatchId_companyId_fkey" FOREIGN KEY ("openingBatchId", "companyId") REFERENCES "OpeningStockBatch"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_reversalOfId_companyId_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "StockDocument"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_documentId_companyId_fkey" FOREIGN KEY ("documentId", "companyId") REFERENCES "StockDocument"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_itemId_companyId_fkey" FOREIGN KEY ("itemId", "companyId") REFERENCES "Item"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_enteredUnitId_companyId_fkey" FOREIGN KEY ("enteredUnitId", "companyId") REFERENCES "UnitOfMeasure"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_locationId_companyId_fkey" FOREIGN KEY ("locationId", "companyId") REFERENCES "WarehouseLocation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_destinationLocationId_companyId_fkey" FOREIGN KEY ("destinationLocationId", "companyId") REFERENCES "WarehouseLocation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_itemId_companyId_fkey" FOREIGN KEY ("itemId", "companyId") REFERENCES "Item"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_locationId_companyId_fkey" FOREIGN KEY ("locationId", "companyId") REFERENCES "WarehouseLocation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_documentId_companyId_fkey" FOREIGN KEY ("documentId", "companyId") REFERENCES "StockDocument"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_lineId_companyId_fkey" FOREIGN KEY ("lineId", "companyId") REFERENCES "StockDocumentLine"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_reversalOfId_companyId_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "StockLedgerEntry"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_companyId_fkey" FOREIGN KEY ("itemId", "companyId") REFERENCES "Item"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_companyId_fkey" FOREIGN KEY ("locationId", "companyId") REFERENCES "WarehouseLocation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIdempotencyRecord" ADD CONSTRAINT "StockIdempotencyRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIdempotencyRecord" ADD CONSTRAINT "StockIdempotencyRecord_resultDocumentId_companyId_fkey" FOREIGN KEY ("resultDocumentId", "companyId") REFERENCES "StockDocument"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-enforced invariants Prisma cannot express directly.
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_valid_range_check" CHECK ("startDate" <= "endDate");
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_positive_factor_check" CHECK ("factorToBase" > 0);
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_valid_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo");
ALTER TABLE "HsnCode" ADD CONSTRAINT "HsnCode_valid_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo");
ALTER TABLE "GstTaxConfiguration" ADD CONSTRAINT "GstTaxConfiguration_valid_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo");
ALTER TABLE "GstTaxConfiguration" ADD CONSTRAINT "GstTaxConfiguration_rates_nonnegative_check" CHECK ("cgstRate" >= 0 AND "sgstRate" >= 0 AND "igstRate" >= 0 AND "cessRate" >= 0);
ALTER TABLE "Item" ADD CONSTRAINT "Item_reorder_nonnegative_check" CHECK ("reorderLevel" >= 0);
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_conversion_positive_check" CHECK ("conversionFactor" > 0);
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_line_nonzero_qty_check" CHECK ("baseQuantity" <> 0);

CREATE OR REPLACE FUNCTION stockerp_guard_financial_year_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."companyId" || ':financial-year-range', 0));
  IF EXISTS (SELECT 1 FROM "FinancialYear" fy WHERE fy."companyId"=NEW."companyId" AND fy."id"<>NEW."id" AND fy."startDate"<=NEW."endDate" AND fy."endDate">=NEW."startDate") THEN
    RAISE EXCEPTION 'Financial years cannot overlap within a company' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinancialYear_no_overlap" BEFORE INSERT OR UPDATE OF "companyId", "startDate", "endDate" ON "FinancialYear" FOR EACH ROW EXECUTE FUNCTION stockerp_guard_financial_year_overlap();

CREATE OR REPLACE FUNCTION stockerp_guard_conversion_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."companyId" || ':' || NEW."itemId" || ':' || NEW."unitId" || ':conversion', 0));
  IF EXISTS (SELECT 1 FROM "ItemUnitConversion" c WHERE c."companyId"=NEW."companyId" AND c."itemId"=NEW."itemId" AND c."unitId"=NEW."unitId" AND c."id"<>NEW."id" AND c."effectiveFrom"<=COALESCE(NEW."effectiveTo", 'infinity'::date) AND COALESCE(c."effectiveTo", 'infinity'::date)>=NEW."effectiveFrom") THEN
    RAISE EXCEPTION 'Item unit conversion effective dates cannot overlap' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ItemUnitConversion_no_overlap" BEFORE INSERT OR UPDATE ON "ItemUnitConversion" FOR EACH ROW EXECUTE FUNCTION stockerp_guard_conversion_overlap();

CREATE OR REPLACE FUNCTION stockerp_guard_hsn_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."companyId" || ':' || NEW."code" || ':hsn', 0));
  IF EXISTS (SELECT 1 FROM "HsnCode" h WHERE h."companyId"=NEW."companyId" AND h."code"=NEW."code" AND h."id"<>NEW."id" AND h."effectiveFrom"<=COALESCE(NEW."effectiveTo", 'infinity'::date) AND COALESCE(h."effectiveTo", 'infinity'::date)>=NEW."effectiveFrom") THEN
    RAISE EXCEPTION 'HSN effective dates cannot overlap for a company and code' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "HsnCode_no_overlap" BEFORE INSERT OR UPDATE ON "HsnCode" FOR EACH ROW EXECUTE FUNCTION stockerp_guard_hsn_overlap();

CREATE OR REPLACE FUNCTION stockerp_guard_tax_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."companyId" || ':' || NEW."code" || ':' || NEW."jurisdiction" || ':' || NEW."taxType" || ':tax', 0));
  IF EXISTS (SELECT 1 FROM "GstTaxConfiguration" t WHERE t."companyId"=NEW."companyId" AND t."code"=NEW."code" AND t."jurisdiction"=NEW."jurisdiction" AND t."taxType"=NEW."taxType" AND t."id"<>NEW."id" AND t."effectiveFrom"<=COALESCE(NEW."effectiveTo", 'infinity'::date) AND COALESCE(t."effectiveTo", 'infinity'::date)>=NEW."effectiveFrom") THEN
    RAISE EXCEPTION 'GST configurations cannot overlap for a company, code, tax type and jurisdiction' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GstTaxConfiguration_no_overlap" BEFORE INSERT OR UPDATE ON "GstTaxConfiguration" FOR EACH ROW EXECUTE FUNCTION stockerp_guard_tax_overlap();

CREATE OR REPLACE FUNCTION stockerp_reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'StockLedgerEntry is append-only; write a reversal or compensating entry' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "StockLedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "StockLedgerEntry" FOR EACH ROW EXECUTE FUNCTION stockerp_reject_ledger_mutation();

CREATE OR REPLACE FUNCTION stockerp_validate_location_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type "LocationType";
BEGIN
  IF NEW."type" = 'WAREHOUSE' THEN
    IF NEW."parentId" IS NOT NULL OR NEW."warehouseId" <> NEW."id" THEN RAISE EXCEPTION 'Warehouse must be a root location whose warehouseId equals its id' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."parentId" IS NULL THEN RAISE EXCEPTION 'Non-warehouse locations require a parent' USING ERRCODE = '23514'; END IF;
  SELECT "type" INTO parent_type FROM "WarehouseLocation" WHERE "id" = NEW."parentId" AND "companyId" = NEW."companyId" AND "warehouseId" = NEW."warehouseId";
  IF parent_type IS NULL OR (NEW."type" = 'RACK' AND parent_type <> 'WAREHOUSE') OR (NEW."type" = 'SHELF' AND parent_type <> 'RACK') OR (NEW."type" = 'BIN' AND parent_type <> 'SHELF') THEN
    RAISE EXCEPTION 'Invalid warehouse location parent type or ownership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WarehouseLocation_validate_tree" BEFORE INSERT OR UPDATE OF "type", "parentId", "companyId", "warehouseId" ON "WarehouseLocation" FOR EACH ROW EXECUTE FUNCTION stockerp_validate_location_tree();

CREATE OR REPLACE FUNCTION stockerp_guard_stock_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD."status"<>'DRAFT' THEN RAISE EXCEPTION 'Posted stock documents cannot be deleted' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status"='REVERSED' THEN RAISE EXCEPTION 'Reversed stock documents are immutable' USING ERRCODE='55000'; END IF;
  IF OLD."status"='POSTED' THEN
    IF NEW."status"<>'REVERSED' OR (NEW."id",NEW."companyId",NEW."financialYearId",NEW."openingBatchId",NEW."type",NEW."documentNumber",NEW."effectiveDate",NEW."reason",NEW."reversalOfId",NEW."createdByUserId",NEW."postedByUserId",NEW."postedAt",NEW."createdAt") IS DISTINCT FROM (OLD."id",OLD."companyId",OLD."financialYearId",OLD."openingBatchId",OLD."type",OLD."documentNumber",OLD."effectiveDate",OLD."reason",OLD."reversalOfId",OLD."createdByUserId",OLD."postedByUserId",OLD."postedAt",OLD."createdAt") THEN
      RAISE EXCEPTION 'Posted stock documents are immutable except for their single reversal transition' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockDocument_lifecycle_guard" BEFORE UPDATE OR DELETE ON "StockDocument" FOR EACH ROW EXECUTE FUNCTION stockerp_guard_stock_document();

CREATE OR REPLACE FUNCTION stockerp_guard_stock_document_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc_status "StockDocumentStatus"; doc_type "StockDocumentType";
BEGIN
  SELECT "status","type" INTO doc_status,doc_type FROM "StockDocument" WHERE "id"=COALESCE(NEW."documentId",OLD."documentId") AND "companyId"=COALESCE(NEW."companyId",OLD."companyId");
  IF doc_status IS DISTINCT FROM 'DRAFT' AND NOT (TG_OP='INSERT' AND doc_type='REVERSAL' AND doc_status='POSTED') THEN
    RAISE EXCEPTION 'Stock document lines are immutable after posting' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockDocumentLine_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "StockDocumentLine" FOR EACH ROW EXECUTE FUNCTION stockerp_guard_stock_document_line();

-- Permission catalogue entries are added without granting restricted capabilities to existing roles.
INSERT INTO "Permission" ("id", "key", "module", "action") VALUES
('phase2-financial-years-view','financial_years.view','financial_years','view'),
('phase2-financial-years-manage','financial_years.manage','financial_years','manage'),
('phase2-finance-period-reopen','finance.period_reopen','finance','period_reopen'),
('phase2-items-view','items.view','items','view'),
('phase2-items-manage','items.manage','items','manage'),
('phase2-taxes-view','taxes.view','taxes','view'),
('phase2-taxes-manage','taxes.manage','taxes','manage'),
('phase2-inventory-opening-manage','inventory.opening.manage','inventory','opening_manage'),
('phase2-inventory-receive','inventory.receive','inventory','receive'),
('phase2-inventory-issue','inventory.issue','inventory','issue'),
('phase2-inventory-transfer','inventory.transfer','inventory','transfer'),
('phase2-inventory-adjust','inventory.adjust','inventory','adjust'),
('phase2-inventory-negative-override','inventory.negative_stock_override','inventory','negative_stock_override'),
('phase2-inventory-reconcile','inventory.reconcile','inventory','reconcile'),
('phase2-inventory-reports-view','inventory.reports.view','inventory','reports_view')
ON CONFLICT ("key") DO NOTHING;

-- Tighten lifecycle guards after the schema objects and relations are present.
CREATE OR REPLACE FUNCTION stockerp_reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc_status "StockDocumentStatus"; doc_company TEXT; doc_item TEXT; doc_date DATE; line_company TEXT; line_item TEXT; line_doc TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'StockLedgerEntry is append-only; write a reversal or compensating entry' USING ERRCODE = '55000'; END IF;
  SELECT "status","companyId","effectiveDate" INTO doc_status,doc_company,doc_date FROM "StockDocument" WHERE "id"=NEW."documentId";
  SELECT "companyId","itemId","documentId" INTO line_company,line_item,line_doc FROM "StockDocumentLine" WHERE "id"=NEW."lineId";
  IF doc_status IS DISTINCT FROM 'POSTED' OR doc_company IS DISTINCT FROM NEW."companyId" OR doc_date IS DISTINCT FROM NEW."effectiveDate" OR line_company IS DISTINCT FROM NEW."companyId" OR line_item IS DISTINCT FROM NEW."itemId" OR line_doc IS DISTINCT FROM NEW."documentId" THEN
    RAISE EXCEPTION 'Ledger entries must reference a matching posted document line' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION stockerp_guard_stock_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD."status"<>'DRAFT' THEN RAISE EXCEPTION 'Posted stock documents cannot be deleted' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status"='REVERSED' THEN RAISE EXCEPTION 'Reversed stock documents are immutable' USING ERRCODE='55000'; END IF;
  IF OLD."status"='DRAFT' AND NEW."status" NOT IN ('DRAFT','POSTED') THEN RAISE EXCEPTION 'Invalid stock document lifecycle transition' USING ERRCODE='55000'; END IF;
  IF OLD."status"='POSTED' THEN
    IF NEW."status"<>'REVERSED' OR (NEW."id",NEW."companyId",NEW."financialYearId",NEW."openingBatchId",NEW."type",NEW."documentNumber",NEW."effectiveDate",NEW."reason",NEW."reversalOfId",NEW."createdByUserId",NEW."postedByUserId",NEW."postedAt",NEW."createdAt") IS DISTINCT FROM (OLD."id",OLD."companyId",OLD."financialYearId",OLD."openingBatchId",OLD."type",OLD."documentNumber",OLD."effectiveDate",OLD."reason",OLD."reversalOfId",OLD."createdByUserId",OLD."postedByUserId",OLD."postedAt",OLD."createdAt") OR NEW."reversedAt" IS NULL OR NEW."reversedByUserId" IS NULL THEN
      RAISE EXCEPTION 'Posted stock documents are immutable except for their single reversal transition' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION stockerp_guard_stock_document_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc_status "StockDocumentStatus"; doc_type "StockDocumentType"; doc_id TEXT; doc_company TEXT; already_has_ledger BOOLEAN;
BEGIN
  doc_id:=COALESCE(NEW."documentId",OLD."documentId"); doc_company:=COALESCE(NEW."companyId",OLD."companyId");
  SELECT "status","type" INTO doc_status,doc_type FROM "StockDocument" WHERE "id"=doc_id AND "companyId"=doc_company;
  IF doc_status='DRAFT' THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF TG_OP='INSERT' AND doc_type='REVERSAL' AND doc_status='POSTED' THEN
    SELECT EXISTS(SELECT 1 FROM "StockLedgerEntry" WHERE "documentId"=doc_id AND "companyId"=doc_company) INTO already_has_ledger;
    IF NOT already_has_ledger THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Stock document lines are immutable after posting' USING ERRCODE='55000';
END;
$$;

CREATE OR REPLACE FUNCTION stockerp_guard_opening_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD."status"='POSTED' THEN RAISE EXCEPTION 'Finalized opening stock batch cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD."status"='POSTED' THEN RAISE EXCEPTION 'Finalized opening stock batch cannot be changed' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD."status"='DRAFT' AND NEW."status" NOT IN ('DRAFT','POSTED') THEN RAISE EXCEPTION 'Invalid opening batch lifecycle transition' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND NEW."status"='POSTED' AND (NEW."finalizedAt" IS NULL OR NEW."finalizedByUserId" IS NULL) THEN RAISE EXCEPTION 'Opening finalization requires actor and timestamp' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OpeningStockBatch_lifecycle_guard" BEFORE UPDATE OR DELETE ON "OpeningStockBatch" FOR EACH ROW EXECUTE FUNCTION stockerp_guard_opening_batch();
