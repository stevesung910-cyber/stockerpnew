import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button, PageHeading, Panel } from "../components/ui";
import { useSession } from "../features/auth/AuthGuard";
import { api, send } from "../services/api";

const path = "/integrations/google-gmail";
const labels = {
  DISABLED: "Disabled",
  DISCONNECTED: "Disconnected",
  CONNECTED: "Connected",
  DISCONNECTING: "Revocation pending",
  REAUTHORIZATION_REQUIRED: "Reauthorization required",
};
type GmailStatus = {
  enabled: boolean;
  senderEmail: string | null;
  status: keyof typeof labels;
  lastSuccessfulSendAt: string | null;
  lastError: string | null;
};
const errors: ReadonlyMap<string, string> = new Map([
  ["CONSENT_DENIED", "Google consent was declined."],
  ["INVALID_CALLBACK", "Google returned an incomplete authorization response. Start again from this page."],
  ["INVALID_STATE", "The authorization expired or was already used. Start again from this page."],
  ["CONNECTION_CHANGED", "The connection changed during authorization. Check its current status."],
  ["EXCHANGE_FAILED", "Google authorization failed. Check the OAuth client and redirect URI."],
  ["IDENTITY_FAILED", "Google account identity could not be verified. Start authorization again."],
  ["SENDER_MISMATCH", "Choose the configured owner Gmail account."],
  ["MISSING_REFRESH_TOKEN", "Google did not grant offline access. Confirm the requested permissions and try again."],
  ["SEND_SCOPE_MISSING", "Grant permission to send email during Google consent."],
  ["TOKEN_REVOKED", "Google authorization expired or was revoked. Disconnect and reconnect."],
  ["REFRESH_FAILED", "Google access could not be refreshed. Check the OAuth configuration and retry."],
  ["DECRYPT_FAILED", "The saved credential could not be decrypted. Check the server encryption key."],
  ["SEND_FAILED", "Gmail acceptance could not be confirmed."],
  ["REVOCATION_FAILED", "Sending is disabled. Retry disconnect to finish Google revocation."],
]);

export function GmailSettings() {
  const { data: session } = useSession();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const queryKey = ["gmail-integration", session?.user.id];
  const status = useQuery({
    queryKey, queryFn: () => api<GmailStatus>(`${path}/status`), enabled: Boolean(session?.canManageGmail), retry: false,
  });
  const connect = useMutation({
    mutationFn: () => send<{ authorizationUrl: string }>(`${path}/connect`),
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });
  const disconnect = useMutation({
    mutationFn: () => send<void>(`${path}/disconnect`),
    onSettled: () => { setParams({}, { replace: true }); return queryClient.invalidateQueries({ queryKey }); },
  });
  if (!session?.canManageGmail) return <Navigate to="/" replace />;

  const data = status.data;
  const result = params.get("result");
  return <>
    <PageHeading eyebrow="SOFTWARE OWNER" title="Google Gmail" description="Manage the Gmail sender used for StockERP email." />
    <Panel className="form-panel">
      {status.isPending && <p role="status">Checking the Gmail connection…</p>}
      {status.isError && <p role="alert">Gmail status could not be loaded.</p>}
      {result && <p role="status">{result === "connected" ? "Gmail connected." : errors.get(result) ?? "Gmail authorization could not be completed."}</p>}
      {data && <>
        <dl>
          <dt>Connection status</dt><dd>{labels[data.status]}</dd>
          <dt>Authorized sender</dt><dd>{data.senderEmail ?? "—"}</dd>
          <dt>Last message accepted by Gmail</dt><dd>{data.lastSuccessfulSendAt ? new Date(data.lastSuccessfulSendAt).toLocaleString() : "—"}</dd>
          <dt>Last error</dt><dd>{data.lastError ? errors.get(data.lastError) ?? "Gmail request failed." : "—"}</dd>
        </dl>
        <p>{data.enabled
          ? "Use the configured Gmail account when Google asks you to sign in. Google acceptance is recorded when Gmail accepts a message for sending."
          : "Set EMAIL_DELIVERY_PROVIDER=google-gmail and configure the backend OAuth client, redirect URI, sender and encryption key. See the StockERP Gmail integration guide."}</p>
        {data.enabled && <div className="form-actions">
          {data.status === "DISCONNECTED"
            ? <Button type="button" disabled={connect.isPending || disconnect.isPending} onClick={() => connect.mutate()}>
                {connect.isPending ? "Opening Google…" : "Connect Gmail"}
              </Button>
            : <Button type="button" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                {disconnect.isPending ? "Disconnecting…" : data.status === "DISCONNECTING" ? "Retry disconnect" : "Disconnect Gmail"}
              </Button>}
        </div>}
      </>}
      {connect.isError && <p className="form-error" role="alert">{connect.error.message}</p>}
      {disconnect.isError && <p className="form-error" role="alert">{disconnect.error.message}</p>}
    </Panel>
  </>;
}
