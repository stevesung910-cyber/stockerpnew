# Inventory API

Base path: `/api/v1`; existing `{data, meta}` and `{error, meta}` envelopes apply. All endpoints require authenticated, verified company context unless noted. The server always derives tenant ID from active membership.

## Implemented endpoint groups

- Financial years: `GET/POST /financial-years`, `GET /financial-years/active`, `POST /financial-years/:id/close`, `POST /financial-years/:id/reopen`.
- Masters: `GET/POST /item-categories`, `GET/POST/PATCH /units`, `POST /units/:id/deactivate`, `GET/POST/PATCH /items`, `POST /items/:id/deactivate`, `GET/POST /items/:id/conversions`, `GET/POST /hsn-codes`, `GET/POST /gst-configurations`, `GET/POST /suppliers`, `GET/POST /customers`.
- Locations: `GET/POST /warehouses`, `GET /warehouses/:id/locations`, `POST /warehouses/:id/locations`.
- Stock: `POST /stock-documents`, `GET /stock-documents`, `GET /stock-documents/:id`, `POST /stock-documents/:id/post`, `POST /stock-documents/:id/reverse`.
- Reads and alerts: `GET /inventory/balances`, `/inventory/ledger`, `/inventory/summary`, `/inventory/low-stock`, `/inventory/reconciliation`, `/inventory/reports/:report`.

List endpoints implemented with pagination include items, categories, parties, documents and ledger. Other master lists return bounded company-scoped records. Posting and reversal require `Idempotency-Key`.

## Restricted/deferred API behavior

- Negative-stock override is rejected pending valuation policy.
- GST resolution/quote is not exposed pending jurisdiction rules.
- Draft update, master detail/update/deactivate coverage is incomplete for categories, HSN/GST, parties and locations.
- Projection rebuild is not exposed. Reconciliation only reports differences.
- Export endpoints are not implemented.
