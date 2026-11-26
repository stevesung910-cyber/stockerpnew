-- Run only after stopping the old workers and confirming Google grant revocation.
-- See docs/GOOGLE_GMAIL_INTEGRATION.md for the full procedure.
UPDATE "EmailIntegrationCredential"
SET status = 'DISCONNECTED', revision = gen_random_uuid()::text,
    "encryptedRefreshToken" = NULL, "encryptionKeyVersion" = NULL,
    "connectedAt" = NULL, "lastTokenRefreshAt" = NULL, "lastError" = NULL,
    "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
WHERE id = 'google-gmail' AND provider = 'google-gmail'
  AND "senderEmail" = :'expected_sender' AND revision = :'expected_revision'
  AND (
    (revision LIKE 'connecting:%' AND status IN ('DISCONNECTED', 'DISCONNECTING')
      AND "encryptedRefreshToken" IS NULL)
    OR (status = 'DISCONNECTING' AND "encryptedRefreshToken" IS NOT NULL
      AND (revision LIKE 'revoking:%'
        OR (revision NOT LIKE 'connecting:%' AND "lastError" = 'REVOCATION_FAILED')))
  )
RETURNING "senderEmail", status, revision,
          "encryptedRefreshToken" IS NOT NULL AS has_credential;
