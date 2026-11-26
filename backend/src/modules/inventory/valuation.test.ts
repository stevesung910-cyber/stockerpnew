import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../../database/generated";
import { issueValue, movingAverageCost, receiptValue, roundCurrency, roundQuantity, roundUnitCost } from "./valuation";

const D = (value: string) => new Prisma.Decimal(value);

describe("company/item moving weighted average decimal policy", () => {
  it("computes consecutive receipts and issue values without binary floating point", () => {
    const firstQuantity = D("100"); const firstValue = receiptValue(firstQuantity, D("10"));
    const secondQuantity = D("100"); const secondValue = receiptValue(secondQuantity, D("20"));
    const average = movingAverageCost(firstQuantity.plus(secondQuantity), firstValue.plus(secondValue));
    assert.equal(average?.toString(), "15");
    assert.equal(issueValue(D("50"), average!).toString(), "750");
    assert.equal(firstValue.plus(secondValue).minus(issueValue(D("50"), average!)).toString(), "2250");
  });

  it("rounds posted currency half up and refuses an average for zero or negative quantity", () => {
    assert.equal(roundCurrency(D("1.005")).toString(), "1.01");
    assert.equal(movingAverageCost(D("0"), D("10")), null);
    assert.equal(movingAverageCost(D("-1"), D("-10")), null);
  });

  it("applies documented quantity and unit-cost scales", () => {
    assert.equal(roundQuantity(D("1.1234567")).toString(), "1.123457");
    assert.equal(roundUnitCost(D("1.123456785")).toString(), "1.12345679");
  });
});
