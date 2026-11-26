import { Prisma } from "../../database/generated";

export const CURRENCY_SCALE = 2;
export const UNIT_COST_SCALE = 8;
export const QUANTITY_SCALE = 6;
export const ROUNDING_MODE = Prisma.Decimal.ROUND_HALF_UP;

export function roundCurrency(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(CURRENCY_SCALE, ROUNDING_MODE);
}

export function roundQuantity(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(QUANTITY_SCALE, ROUNDING_MODE);
}

export function roundUnitCost(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(UNIT_COST_SCALE, ROUNDING_MODE);
}

export function movingAverageCost(quantity: Prisma.Decimal, value: Prisma.Decimal): Prisma.Decimal | null {
  if (quantity.lte(0)) return null;
  return value.div(quantity);
}

export function receiptValue(quantity: Prisma.Decimal, unitCost: Prisma.Decimal): Prisma.Decimal {
  return roundCurrency(quantity.mul(roundUnitCost(unitCost)));
}

export function issueValue(quantity: Prisma.Decimal, averageCost: Prisma.Decimal): Prisma.Decimal {
  return roundCurrency(quantity.mul(roundUnitCost(averageCost)));
}
