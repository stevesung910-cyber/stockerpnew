# API Contracts

Base path: `/api/v1`. Success payloads use `{ "data": ..., "meta": { "requestId": "..." } }`; errors use `{ "error": { "code": "...", "message": "...", "details"?: ... }, "meta": { "requestId": "..." } }`.

## Authentication and email ownership

Sessions use the `stockerp_session` HttpOnly, SameSite=Lax cookie, scoped to `/api/v1`, with an eight-hour expiry. It is Secure in production and whenever environment configuration is absent or invalid. Plain HTTP is permitted only when `APP_ENV` and `NODE_ENV` both explicitly identify the same local mode (development/development or test/test). Production startup requires `APP_ENV=production`, `NODE_ENV=production`, an HTTPS `FRONTEND_ORIGIN`, runtime `DATABASE_URL`, and HTTPS email-provider configuration, the owner address, and a dedicated registration OTP HMAC key. Production migrations use the separate `DATABASE_URL_MIGRATION` connection.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public, rate limited | Reserve a pending registration and initiate owner-only approval notification. Generic 202 with an opaque `continuation` for eligible and duplicate requests |
| POST | `/auth/register/confirm` | Public, rate limited | Accept `{ continuation, otp }` with an eight-digit string. Approve once and create the user; no session. Invalid and unavailable codes share a generic 400 |
| POST | `/auth/register/resend` | Public, rate limited | Accept `{ continuation }`. Generic 202; replacement only after the server cooldown and within request limits |
| POST | `/auth/login` | Public, rate limited | Authenticate an eligible active account and create a session; generic 401 otherwise |
| POST | `/auth/logout` | Cookie optional; origin checked when cookie is present | Revoke current session and clear cookie |
| GET | `/auth/me` | Session | `ownerApprovedAt`, `emailVerifiedAt`, eligibility, active company and authorized memberships |
| POST | `/auth/verify-email/request` | Session, rate limited | Request account verification instructions; generic response |
| POST | `/auth/verify-email/legacy-request` | Public, rate limited | Accept `{ email, password }` to request a mailbox link for an unverified legacy account; generic 202 |
| POST | `/auth/verify-email/confirm` | Public, rate limited | Accept `{ token, password }` and consume an expiring one-time mailbox link with the current password |
| POST | `/auth/forgot-password` | Public, rate limited | Request reset instructions; generic response regardless of account existence |
| POST | `/auth/reset-password` | Public, rate limited | Consume one-use token, change password, revoke all sessions and invalidate other reset tokens |

Registration codes are never disclosed by the API. Recovery requests and redemption require a verified mailbox. Reset and mailbox verification tokens are disclosed in a response only when all three local-only conditions are true: `APP_ENV=development`, `NODE_ENV=development`, and `AUTH_DEV_EXPOSE_TOKENS=true`. Startup rejects this setting in production. With email delivery unconfigured, tokens are not created or returned except through that explicit development workflow.

Missing registration delivery configuration returns `503 REGISTRATION_UNAVAILABLE`. See [Owner-controlled registration approval](OWNER_REGISTRATION_APPROVAL.md) for configuration and rollout.

## Companies, membership and authorization

All `/companies` routes require an eligible authenticated account. Email invitation acceptance additionally requires a verified matching mailbox. The active tenant is loaded from the authenticated server-side session. Request-supplied company IDs are only candidates for switching or explicit company administration; every operation separately validates active membership and permission.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/companies` | Eligible session | List active memberships |
| POST | `/companies` | Eligible session + policy | First company for a zero-membership account; later companies require active Company Admin authority |
| POST | `/companies/switch` | Eligible session | Revalidate target membership and company state before changing session context |
| GET/PATCH | `/companies/current` | Company context + `company.view` / `company.edit` | Read/update active company profile |
| PATCH | `/companies/current/status` | Company context + `company.edit` | Deactivate active company and clear active session contexts |
| PATCH | `/companies/:companyId/status` | Active target-company membership + `company.edit` | Reactivate/deactivate a membership-owned company |
| POST | `/companies/:companyId/archive` | Active target-company membership + `company.edit` | Soft archive company |
| GET | `/companies/members` | Active context + `users.view` | List members scoped to active company |
| GET | `/companies/assignable-roles` | Active context + `users.create` | Return only roles within caller authority |
| POST | `/companies/invitations` | Active context + `users.create` | Create one-time email invitation; no membership is created |
| POST | `/companies/invitations/accept` | Eligible session | Accept invitation only when verified account email matches |
| PATCH | `/companies/members/:membershipId` | Active context + `users.edit` | Change member status or authorized company role; target is tenant-scoped |
| GET | `/companies/roles` | Active context + `roles.view` | Read company roles and permission catalogue |
| PATCH | `/companies/roles/:roleId` | Active context + `roles.edit` | Edit role within the acting user's permission ceiling |

Company Admins may grant only roles whose permissions they hold; the reserved `SUPER_ADMIN` seed cannot be granted or edited through company APIs. Other user managers may grant only roles whose complete permission sets are subsets of their own. `COMPANY_ADMIN` can be granted only by a current Company Admin. Role and membership modifications recheck the acting membership inside a serializable transaction.

## Email provider boundary

`EMAIL_PROVIDER_URL` and `EMAIL_PROVIDER_API_KEY` configure a provider-independent HTTPS JSON endpoint. StockERP sends `{to, subject, text}` with a bearer token and a ten-second timeout. There is no paid-provider dependency. Production requires both settings; local development may omit them and use the explicitly enabled local token workflow. A failed delivery removes the unsent token/invitation; API responses do not claim delivery succeeded.

## Validation and pagination

Passwords must be 12–128 characters. Indian mobile numbers supplied for company profiles must be exactly 10 digits. List endpoints will use 1-based `page`, `pageSize` (10, 25, 50, 100), optional `search`, `sortBy` and `sortOrder` as business modules are introduced.

The API rejects state-changing cookie requests whose `Origin` does not exactly match `FRONTEND_ORIGIN`. Unknown origins receive no credentialed CORS access.

## Phase 2 inventory endpoints

Phase 2 uses the same `/api/v1` router, response envelopes, authenticated company context and permission middleware. Implemented endpoint groups and their current restrictions are maintained in [Inventory API](INVENTORY_API.md). All inventory list/detail/report queries include the authenticated `companyId`; request-supplied company IDs never establish tenant context.

Posting and reversal require `Idempotency-Key`. Keys are scoped by company and operation, stored with a request hash and result document in the same transaction, and retained with the document. Reusing a key with another payload returns a conflict. Negative stock remains denied even when the explicit override key is present. GST rate resolution and projection rebuild are currently restricted.
