import dotenv from "dotenv";
import { resolve } from "node:path";
dotenv.config({ path: resolve(process.cwd(), ".env") });
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../database/generated";
import { prisma } from "../../database/prisma";

async function rolledBack<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const marker = new Error("ROLLBACK_INVENTORY_TEST_FIXTURE"); let result!: T;
  try {
    await prisma.$transaction(async tx => { result = await work(tx); throw marker; });
  } catch (error) {
    if (error !== marker) throw error;
  }
  return result;
}

describe("Phase 2 database integrity", () => {
  before(async () => { assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/); await prisma.$connect(); });
  after(async () => { await prisma.$disconnect(); });

  it("rejects cross-company item to unit relationships", async () => {
    let code: string | undefined;
    await rolledBack(async tx => {
      const one = await tx.company.create({ data: { name: `P2 tenant A ${randomUUID()}` } });
      const two = await tx.company.create({ data: { name: `P2 tenant B ${randomUUID()}` } });
      const unit = await tx.unitOfMeasure.create({ data: { companyId: one.id, code: "EA", name: "Each", symbol: "ea" } });
      await tx.$executeRawUnsafe("SAVEPOINT cross_tenant_check");
      try { await tx.item.create({ data: { companyId: two.id, code: "CROSS", name: "Cross tenant", baseUnitId: unit.id } }); }
      catch (error) { code = (error as { code?: string }).code; await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT cross_tenant_check"); }
      return undefined;
    });
    assert.equal(code, "P2003");
  });

  it("keeps posted ledger entries append-only through PostgreSQL", async () => {
    let blocked = false;
    await rolledBack(async tx => {
      const c = await tx.company.create({ data: { name: `P2 ledger ${randomUUID()}` } });
      const unit = await tx.unitOfMeasure.create({ data: { companyId: c.id, code: "EA", name: "Each", symbol: "ea" } });
      const item = await tx.item.create({ data: { companyId: c.id, code: "LEDGER", name: "Ledger item", baseUnitId: unit.id } });
      const locationId = randomUUID();
      await tx.warehouseLocation.create({ data: { id: locationId, companyId: c.id, warehouseId: locationId, type: "WAREHOUSE", code: "MAIN", name: "Main" } });
      const year = await tx.financialYear.create({ data: { companyId: c.id, code: "FYTEST", timezone: "Asia/Kolkata", startDate: new Date("2026-04-01T00:00:00Z"), endDate: new Date("2027-03-31T00:00:00Z") } });
      const document = await tx.stockDocument.create({ data: { companyId: c.id, financialYearId: year.id, type: "RECEIPT", status: "DRAFT", documentNumber: "TEST-1", effectiveDate: new Date("2026-04-01T00:00:00Z"), createdByUserId: "integration-test" } });
      const line = await tx.stockDocumentLine.create({ data: { companyId: c.id, documentId: document.id, lineNumber: 1, itemId: item.id, locationId, enteredQuantity: new Prisma.Decimal(2), enteredUnitId: unit.id, conversionFactor: new Prisma.Decimal(1), baseQuantity: new Prisma.Decimal(2), unitCost: new Prisma.Decimal(3), lineValue: new Prisma.Decimal(6) } });
      await tx.stockDocument.update({ where: { id: document.id }, data: { status: "POSTED", postedAt: new Date(), postedByUserId: "integration-test" } });
      const entry = await tx.stockLedgerEntry.create({ data: { companyId: c.id, itemId: item.id, locationId, documentId: document.id, lineId: line.id, effectiveDate: document.effectiveDate, signedBaseQuantity: new Prisma.Decimal(2), signedInventoryValue: new Prisma.Decimal(6), unitCost: new Prisma.Decimal(3), entryType: "RECEIPT" } });
      await tx.$executeRawUnsafe("SAVEPOINT ledger_mutation_check");
      try { await tx.stockLedgerEntry.update({ where: { id: entry.id }, data: { signedBaseQuantity: new Prisma.Decimal(1) } }); }
      catch { blocked = true; await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ledger_mutation_check"); }
      return undefined;
    });
    assert.equal(blocked, true);
  });
});
