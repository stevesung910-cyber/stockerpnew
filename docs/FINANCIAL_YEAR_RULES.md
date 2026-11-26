# Financial Year Rules

**Implemented in service/schema; database verification pending.**

Financial years are company-scoped, explicit inclusive DATE ranges, and cannot overlap. Each year snapshots the company's IANA timezone. `Company.timezone` defaults to `Asia/Kolkata` and is configurable in Company Settings; effective dates are business dates and audit/creation timestamps remain timestamps.

A document must reference an open financial year containing its effective date. Closing takes the shared year advisory lock, reconciles projection against ledger, and records actor/time. Reopening requires `finance.period_reopen`, a reason, audit event, and a different actor from the closer. Monthly close is out of scope.

The current financial year is derived from the company timezone and today's business date; there is no independent active-year pointer. A document workflow still selects the explicit financial year.
