import { gmailConfiguration } from "../google-gmail/gmail-config";
import { GoogleGmailEmailDeliveryProvider } from "../google-gmail/gmail-service";
import { SmtpEmailDeliveryProvider, smtpConfiguration } from "./smtp-email-delivery";

export type OutboundEmail = { to: string; subject: string; text: string };

/** Minimal provider boundary. A provider may be a company-operated HTTPS JSON endpoint. */
export interface EmailDeliveryProvider {
  send(message: OutboundEmail): Promise<void>;
}

export class HttpEmailDeliveryProvider implements EmailDeliveryProvider {
  constructor(private readonly endpoint: string, private readonly apiKey: string) {}

  async send(message: OutboundEmail): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(message),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
  }
}

export function configuredEmailProvider(): EmailDeliveryProvider | undefined {
  const smtp = smtpConfiguration();
  if (smtp) return new SmtpEmailDeliveryProvider(smtp);
  const gmail = gmailConfiguration();
  if (gmail) return new GoogleGmailEmailDeliveryProvider(gmail);
  const endpoint = process.env.EMAIL_PROVIDER_URL;
  const apiKey = process.env.EMAIL_PROVIDER_API_KEY;
  if (!endpoint || !apiKey) return undefined;
  const url = new URL(endpoint);
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("EMAIL_PROVIDER_URL must be an HTTP(S) URL without embedded credentials.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("EMAIL_PROVIDER_URL must use HTTPS in production.");
  }
  return new HttpEmailDeliveryProvider(url.toString(), apiKey);
}

export function hasConfiguredEmailProvider(): boolean {
  return Boolean(smtpConfiguration() || gmailConfiguration() || (process.env.EMAIL_PROVIDER_URL && process.env.EMAIL_PROVIDER_API_KEY));
}

export async function deliverEmail(message: OutboundEmail, provider = configuredEmailProvider()): Promise<boolean> {
  if (!provider) return false;
  await provider.send(message);
  return true;
}
