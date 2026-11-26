# Stock Posting Rules

**Core posting/reversal path implemented; integration verification pending.**

## Lifecycle

Documents move Draft → Posted → Reversed. Drafts have no stock effect. Posting creates immutable ledger entries and updates projection rows atomically with status, audit and idempotency state. Posted documents cannot be edited or deleted through the service; PostgreSQL triggers protect posted documents/lines and ledger entries.

Supported document types: opening, receipt, issue, transfer, adjustment and reversal. Adjustment quantity is signed. GST is excluded from inventory value.

## Posting controls

- Every mutation derives company context from the authenticated session and checks a server permission.
- The effective date must be inside an open company financial year.
- Posting uses transaction-scoped period, company/item, location-mode and idempotency advisory locks; item/location lock keys are sorted.
- Idempotency keys are scoped by company and operation and stored with a request hash and result document. Same-key retries replay the original result; different payloads conflict. Records are retained with the document.
- Negative balances are denied, including when the override permission is present, until negative valuation is designed.

## Opening stock

One company-scoped opening batch may contain one document with multiple item/location lines. It finalizes on successful posting. Normal stock posting is blocked until that batch is posted. No second batch can be finalized.

## Reversal

Reversal is full-only, creates a separate linked posted document, stores reason/actor/time, and uses the original date if its period is still open; otherwise it uses the current company business date and an open year. Later movements for the same item must be reversed first. Unsafe reversals fail without changing the original. A reversal requires its own idempotency key.

## Known gaps

Draft edit endpoints, partial reversals, a controlled projection rebuild, and functional negative-stock override are not implemented. Integration tests for concurrent posting, rollback and reversal dependencies remain unverified because PostgreSQL was unavailable.
