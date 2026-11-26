# Stock Valuation Rules

**Implemented in application code; database integration verification pending.**

## Method

Perpetual moving weighted average is calculated per company and item across all warehouses and bins. Location values are projections of the company/item pool; bins do not keep separate average costs.

- Receipts and opening entries use the entered base-unit cost and update quantity and value.
- Issues use the current company/item average cost.
- Transfers remove and add the same carrying value and do not change company-wide quantity or value.
- Negative quantity is rejected. The override key is seeded but no unsafe negative valuation path is enabled.

## Decimal and rounding policy

- PostgreSQL `NUMERIC(20,6)` quantity and conversion factor.
- `NUMERIC(20,8)` unit cost.
- `NUMERIC(20,2)` posted currency movement/value.
- JavaScript uses Prisma's Decimal implementation for inventory arithmetic.
- Quantity and unit cost are rounded to their stored scale with `ROUND_HALF_UP` when prepared for posting. Monetary movement is rounded to two places at the ledger movement boundary. A final issue that consumes the remaining company quantity consumes the remaining projected company value to avoid a residual value after quantity reaches zero.

The `100 × ₹10` plus `100 × ₹20` example produces average ₹15; issuing 50 units produces ₹750 and leaves quantity 150/value ₹2,250. This example is covered by a passing unit test.

## Restricted behavior

A receipt after an authorized negative issue cannot be valued consistently until the cost-adjustment and intervening-movement algorithm is approved and tested. Since posting such issues is disabled, the later-receipt correction path is also disabled.
