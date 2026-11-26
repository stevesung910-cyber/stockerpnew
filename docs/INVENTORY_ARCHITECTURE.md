# StockERP Inventory Architecture

**Status: Partially implemented; database migration and integration verification pending.**

## Boundaries

- React/Vite calls the existing Express `/api/v1` router and response envelope.
- Express derives `companyId` from the authenticated active-company context. Request bodies do not establish tenant context.
- Prisma models are in `database/prisma/schema.prisma`; the additive migration is `20261125130000_phase2_inventory`.
- `StockLedgerEntry` is the movement history. `StockBalance` is a transactional projection keyed by company, item and location. Company/item average cost is derived from aggregate projected quantity and value.
- Phase 1 authentication, membership, permission ceiling and audit services are reused. RLS remains deferred.

## Transaction design

Stock posting creates/reuses an idempotency result, checks the company financial year and document, obtains a transaction-scoped period advisory lock and sorted company/item advisory locks, validates conversion and location mode, calculates decimal valuation, writes ledger entries and balance deltas, changes document/batch state, records idempotency and audit data, and commits atomically. Posting retries PostgreSQL serialization/deadlock conflicts up to three attempts.

Closing obtains the same period lock before reconciling and closing. Reversal takes the selected financial-year locks and item locks, validates downstream movement and current balances, writes an inverse linked document and entries, marks the original Reversed, and audits in one transaction.

## Tenant integrity

Company-owned tables have `companyId`, company-scoped identifiers, and composite foreign keys for relationships between tenant-owned models. Queries explicitly filter by the authenticated company. Database hierarchy and overlap triggers backstop service validation.

## Operational limitations

- Negative-stock posting is blocked even if a user has `inventory.negative_stock_override`; no valuation/recovery algorithm is implemented.
- GST master records exist, but rate resolution and commercial-document tax snapshots are restricted pending jurisdiction rules.
- Projection reconciliation is read-only. A controlled projection rebuild is not exposed until its maintenance authority and recovery process are approved.
- Runtime and migration PostgreSQL role separation has not been applied or tested against this deployment.
- The Phase 2 migration has not been applied to any database in this work. The local PostgreSQL service was unavailable.
