# StockERP Gmail delivery

Gmail can deliver StockERP registration approval, mailbox verification, invitation and password recovery email through the existing provider interface. Registration approval sends its OTP to `REGISTRATION_OWNER_EMAIL`. The software owner reviews the request and shares the OTP manually. Confirming it creates an owner-approved account with `emailVerifiedAt = NULL`. Mailbox verification remains required for invitation acceptance and email-based password recovery.

## Google Cloud setup

1. Open the **StockERP-Mail** project in the Google Cloud console and enable **Gmail API** (`gmail.googleapis.com`).
2. In Google Auth Platform, set the branding application name to **StockERP** and set the audience to **External**. While publishing status is **Testing**, add the configured Gmail sender under **Test users**.
3. In **Data Access** configure `https://www.googleapis.com/auth/gmail.send`. StockERP also requests `openid` and `email` to verify the identity of the Google account that granted access.
4. Under **Clients**, use the **StockERP Gmail Sender** OAuth client of type **Web application**. Add the complete backend URI under **Authorized redirect URIs**. Copy that exact value into `GOOGLE_OAUTH_REDIRECT_URI`. Keep the existing OAuth client ID and secret in server configuration.

Google issues refresh tokens that expire after seven days when the app audience is **External** and its publishing status is **Testing**. The exception for basic identity-only scopes does not apply to StockERP because it also requests `gmail.send`. The next send that encounters an expired token moves StockERP to **Reauthorization required**. In Testing, disconnect and authorize again to obtain another short-lived grant. For production, publish the app, complete any applicable Google verification, and reconnect to obtain a grant under the published configuration. [Google refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration) and [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## StockERP deployment configuration

`@googleapis/gmail` is a direct backend runtime dependency pinned in `backend/package.json` and resolved in the root lockfile. Install with the normal locked workspace install (`npm ci`) and include backend production dependencies in the runtime artifact.

| Environment | OAuth client and deployment settings |
| --- | --- |
| Local development | Use a development OAuth client and test mailbox. For the stock setup, register `http://localhost:4000/api/v1/integrations/google-gmail/callback`, set `FRONTEND_ORIGIN=http://localhost:5173` and use `http://localhost:4000/api/v1` for `VITE_API_BASE_URL`. Use the same loopback hostname for both frontend and API. |
| Staging | Use a separate database, OAuth client, mailbox and secrets. Use HTTPS frontend and API origins, register the exact staging callback, and run with `APP_ENV=production` and `NODE_ENV=production` to exercise production checks. If Google External OAuth is in Testing, list the staging mailbox as a test user and expect seven-day refresh-token expiry. |
| Production | Use the production database, OAuth client, mailbox and secrets. Run with `APP_ENV=production` and `NODE_ENV=production`, with development token exposure disabled. Use the published OAuth configuration and register the exact public HTTPS API callback. |

For each environment, `GOOGLE_OAUTH_REDIRECT_URI` is the browser-facing **backend** origin plus `/api/v1/integrations/google-gmail/callback`, with no query string, fragment or trailing slash. It must match the Google Cloud entry exactly. Set `VITE_API_BASE_URL` to the same backend origin plus `/api/v1`. Keep frontend and API same-site for session cookies. If TLS terminates at a reverse proxy, configure `TRUSTED_PROXY_NETWORKS` and accept the forwarded HTTPS scheme only from that proxy. [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

Use your server's secret manager or edit the local backend `.env` directly. The table lists the values to provision.

| Variable | Value |
| --- | --- |
| `EMAIL_DELIVERY_PROVIDER` | `google-gmail` |
| `SOFTWARE_OWNER_USER_ID` | Immutable StockERP user ID of the existing, active, mailbox-verified software-owner account |
| `REGISTRATION_OWNER_EMAIL` | Software owner’s registration-approval inbox |
| `GOOGLE_GMAIL_SENDER_EMAIL` | Google mailbox authorized to send, matching `REGISTRATION_OWNER_EMAIL` |
| `GOOGLE_OAUTH_CLIENT_ID` | Existing Google web OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Existing Google web OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Complete callback URI registered in Google Cloud |
| `GOOGLE_OAUTH_ENCRYPTION_KEY` | Independent random 32-byte key as 64 hex characters |
| `OWNER_REGISTRATION_OTP_HMAC_SECRET` | Existing independent OTP HMAC secret |
| `FRONTEND_ORIGIN` | Actual frontend origin, with HTTPS in production |

Generate the encryption key locally with `openssl rand -hex 32` in a private terminal and store it in the deployment secret manager. Use a new key independent of the database password, OAuth client secret and OTP secret. Keep real values out of chat, source control and shell transcripts. All backend replicas must use the same Gmail OAuth client, encryption key and software owner ID.

Apply the additive migration `20261125150000_google_gmail_integration` through the normal reviewed migration process and generate the Prisma client before deploying the backend. The migration creates `EmailIntegrationCredential`, `GmailOAuthState` and their connection status enum. Production TLS, a migration role, and outbound HTTPS access to Google OAuth, UserInfo and Gmail API endpoints are required. Suppress query strings and redirect headers for the OAuth routes in proxies, access logs, tracing and analytics. Include neither email bodies nor provider request/response payloads in telemetry.

## Owner authorization and connection

A deployment operator sets `SOFTWARE_OWNER_USER_ID` using the existing verified software owner's user ID from a trusted database read or the owner's authenticated `/api/v1/auth/me` response. If the owner needs to verify their StockERP mailbox, complete verification using the existing HTTP provider before switching delivery to Gmail. The verified StockERP sign-in and the Gmail sender are separate identities. Tenant administration and owner-approved registration alone grant no integration permissions.

1. Sign in to StockERP as the configured software owner and open **Google Gmail** in the sidebar.
2. Choose **Connect Gmail**. Keep the same session for the return from Google.
3. Choose the configured Gmail account and allow Gmail sending.
4. Verify the page shows **Connected**. StockERP validates the Google account and granted scope before saving an encrypted offline credential. Replacing a live credential requires disconnecting first.

The settings page initiates OAuth with a session-authenticated `POST /api/v1/integrations/google-gmail/connect`. StockERP requires the exact configured frontend Origin for CSRF protection and returns the Google authorization URL in a no-store JSON response. The browser navigates to Google and returns through the GET callback. OAuth state expires after ten minutes, can be used once and is bound to the initiating session. Its digest is stored in PostgreSQL and PKCE uses S256. The refresh token is stored under AES-256-GCM with a random nonce and key version. The configured OAuth client and sender are authenticated as associated data. StockERP fetches a short-lived access token when sending and uses it in memory. Gmail's send request is attempted once so an ambiguous response does not trigger duplicate delivery.

### Credential transitions

Both email settings require a single valid mailbox with no surrounding or embedded whitespace. StockERP compares their lowercase forms. To change senders, disconnect with the old settings first, then update both addresses and authorize the new sender. StockERP can reassign an empty, disconnected credential row.

- A callback consumes its matching, unexpired session state once, then claims the disconnected credential with a new revision. That write commits before the token exchange. Google identity verification remains mandatory. A missing scope value means the original scopes were granted, while an explicit scope list must include Gmail sending. [OAuth 2.0 token response](https://www.rfc-editor.org/rfc/rfc6749#section-5.1).
- The callback can publish the encrypted credential only while its own revision is still current and disconnected. Exchange failure releases that claim with a sanitized error. If a disconnect marks the claim `DISCONNECTING` during exchange, the callback can only store the returned credential under a revocation claim and revoke it. It cannot enable sending.
- Disconnect claims a single revocation revision in `DISCONNECTING` before calling Google. Only that claim can clear the token on success or release it for retry on failure. A reported invalid token counts as already revoked. A concurrent request gets HTTP 409 while the change is in progress or if its revision is stale. A failed revocation gets HTTP 502 and retains the encrypted token for retry.
Neither Google call holds a transaction or row lock. The revision fences concurrent work across backend instances. Use the row state to decide whether a normal retry is available.

| Status | Revision | Credential | Normal behavior |
| --- | --- | --- | --- |
| `DISCONNECTED` | Plain UUID | Empty | Start a new OAuth flow. Pending OAuth state is valid only for this revision. |
| `DISCONNECTED` | `connecting:<uuid>` | Empty | Exchange in progress. A disconnect moves the claim to `DISCONNECTING`. |
| `DISCONNECTING` | `connecting:<uuid>` | Empty | Exchange canceled. Its worker must finish and revoke any credential it receives. |
| `DISCONNECTING` | `revoking:<uuid>` | Encrypted | Revocation in progress. Other disconnect attempts return 409. |
| `DISCONNECTING` | Plain UUID | Encrypted | Revocation failed and released its claim. Retry disconnect with the original configuration. |
| `CONNECTED` | Plain UUID | Encrypted | Sends are enabled. Disconnect before replacing the credential. |
| `REAUTHORIZATION_REQUIRED` | Plain UUID | Encrypted | Google rejected the grant. Disconnect and authorize again. |

### Recover an interrupted operation

An interrupted exchange or revocation can leave its active revision in place indefinitely. Elapsed time alone cannot establish that the worker stopped or that Google finished processing. Use this procedure for an abandoned `connecting:` or `revoking:` claim, or for a released `DISCONNECTING` revocation with `REVOCATION_FAILED` when a normal retry is impossible (for example, the original encryption key is lost).

1. Take Gmail integration traffic and delivery offline. Stop every old backend replica and worker that can exchange, revoke, refresh or send for this integration. Disable automatic restarts until recovery is complete and confirm the workers have exited.
2. In the configured sender’s Google Account, remove the affected app’s access and confirm that the grant is revoked. If an in-flight request reached Google, confirm the grant has been removed after that request has settled. Complete this step before touching the database. If you cannot confirm revocation, keep the integration offline.
3. Connect with `psql` to the intended environment using an authorized maintenance role. Verify `current_database()` and the environment, then inspect the integration row without selecting ciphertext. Record the precise revision and sender. Run the guarded update in the same session using those observed values. The example assumes `psql` was started from the repository root.

   ```sql
   SELECT current_database();
   SELECT "senderEmail", status, revision, "lastError",
          "encryptedRefreshToken" IS NOT NULL AS has_credential
   FROM "EmailIntegrationCredential"
   WHERE id = 'google-gmail' AND provider = 'google-gmail';

   \prompt 'Observed sender: ' expected_sender
   \prompt 'Observed revision: ' expected_revision
   \i scripts/maintenance/recover-gmail.sql
   ```

4. Require exactly one returned row with `DISCONNECTED`, a fresh revision and `has_credential = false`. If no row was updated, keep the integration offline and recheck the row and recovery conditions. The update preserves the last successful send timestamp and leaves accounts, sessions and OAuth state rows intact. Previously issued OAuth state and any late operation completion cannot write credentials under the fresh revision.
5. Restart with the intended configuration. The software owner must select **Connect Gmail** again and complete fresh Google authorization before email can resume.

## Manual live-delivery verification

Use a staging deployment with its own database and OAuth client where available. Connect the designated sender, then open stock registration in a separate clean browser session. Register using a fresh client email you control. Check both the owner's Gmail inbox and the client inbox. Confirm the owner receives the approval OTP and the client does not. Verify that the owner settings timestamp advances when Gmail accepts the message. The timestamp alone does not establish inbox delivery. Check Spam if necessary.

Confirm registration with the OTP supplied by the owner. Verify that the new user can sign in, the account shows owner approval, and the mailbox remains unverified. Before verifying the client mailbox, request password recovery and check that it produces no reset email for that client. Keep test OTPs and credentials private.

For automated coverage use `npm run test:phase1:unit` and `npm run test:gmail`. The latter requires an already-migrated `stockerp_test` database and verifies the connected database name before writing fixtures. It does not run migrations. Google calls are mocked.

## Troubleshooting, disconnect and rotation

- **Redirect URI mismatch**. Compare the exact Google OAuth client redirect entry against `GOOGLE_OAUTH_REDIRECT_URI` and the API origin used in the browser.
- **Access blocked**. Confirm the owner Gmail is a Testing audience test user, the API is enabled, and the send permission was granted. For a sender mismatch, restart the flow and select the configured Gmail.
- **Invalid state**. Start again from the settings page. Keep one active authorization per browser session and avoid changing cookie hosts between connect and callback.
- **Reauthorization required**. An expired or revoked grant can no longer refresh access. Choose **Disconnect Gmail**, then connect again. While Gmail is selected and disconnected, email has no automatic HTTP fallback.
- **Send failed**. Gmail acceptance could not be confirmed. Check Gmail's Sent folder and the recipient mailbox before requesting a fresh code. Existing OTP resend limits apply.
- **Revocation pending**. StockERP blocks new sends and retains the encrypted credential to retry revocation. Choose **Retry disconnect** once Google is reachable. An already in-flight send can finish. After Google confirms revocation or identifies the token as invalid, StockERP clears the stored token. The owner can also remove StockERP's access in their Google Account.
- **Encryption key or OAuth client rotation**. Disconnect and confirm revocation while the original key and client configuration are still active. Then update the secrets across replicas, restart and reconnect. If the original key is lost, revoke the app in the owner's Google Account and have the deployment operator follow the interrupted-operation recovery procedure above. Key version 1 has no online re-encryption path.
