# StockERP Phase 2 Architecture and Implementation Decisions

**Status: Implementation in progress; Phase 2 is not complete or PostgreSQL-verified.** The user-authorized scope is Phase 2 only. No migration has been applied to development or production.

## Confirmed architecture

- Company-wide moving weighted average per item; transfers preserve carrying value.
- One initial go-live opening batch per company.
- Warehouse and Bin are stock-bearing locations in Warehouse → Rack → Shelf → Bin hierarchy.
- Draft → Posted → Reversed lifecycle with one full linked reversal.
- Annual financial-year close; company-scoped, explicit, non-overlapping periods.
- Separate `taxes.view` and `taxes.manage` permissions.
- Negative stock denied by default; explicit override requires permission, reason and audit.
- RLS deferred; tenant isolation remains server-derived, query-scoped and composite-key enforced.

## Engineering contracts recorded in code

- NUMERIC scales: quantity/conversion `20,6`, unit cost `20,8`, inventory currency `20,2`.
- Rounding: `ROUND_HALF_UP`; quantity/cost quantized to their scale and currency at posted movement boundaries.
- Company timezone is an IANA timezone, default `Asia/Kolkata`, configurable in Company Settings. Financial dates use PostgreSQL DATE; Prisma operational timestamps use `TIMESTAMP(3)` and are interpreted as UTC.
- Posting locks the financial year, idempotency scope, sorted company/item keys and sorted warehouse stock-mode keys inside a serializable transaction. Serialization/deadlock retries are bounded to three.
- Idempotency keys are company/operation scoped, request-hash checked, and retained with the posting result.
- Full reversals use original date in an open original year; otherwise current company business date in an open year. Dependent same-item movements are reversed first. Reopen requires a different actor than the closer.
- Opening stock is one multi-line document in the one company batch; successful posting finalizes it and blocks repeated opening.
- Company Admin receives normal inventory/master/tax capabilities but not `inventory.negative_stock_override`, `finance.period_reopen` or `inventory.reconcile`. Store roles receive the narrow operational keys defined in `role-seed.ts`; sensitive permissions are not auto-granted.
- Lot, serial and expiry tracking are excluded from initial Phase 2.

## Safe restrictions and unresolved business rules

- Negative-stock posting stays blocked for everyone until a cost-adjustment rule for later receipts and intervening movements is defined and tested.
- GST tax configuration masters are available; rate resolution/quotation and commercial-document snapshots are withheld pending jurisdiction, place-of-supply and precedence rules.
- Projection rebuild is not exposed pending maintenance authority, database-role and recovery decisions.
- A controlled location relocation and complete edit/deactivation workflows for every master are not implemented.

## Migration and verification status

The additive migration is `20261125130000_phase2_inventory`. It includes company-scoped models/constraints, period/conversion/tax overlap guards, typed location checks, document lifecycle protection, append-only ledger protection and permission catalogue entries. It was statically reviewed for destructive DDL; no `DROP` or `TRUNCATE` is present.

Prisma generation, validation, TypeScript typecheck and 10 unit tests passed. PostgreSQL is stopped/unreachable in the environment; `npm run test:phase2` and read-only development migration status both failed with `P1001`. Therefore neither migration deploy nor database constraint behavior is verified. See [Phase 2 Testing](PHASE2_TESTING.md), [Deployment Preparation](PHASE2_DEPLOYMENT.md) and [Project Progress](PROJECT_PROGRESS.md).
