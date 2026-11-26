import nodemailer from "nodemailer";
import { z } from "zod";
import type { EmailDeliveryProvider, OutboundEmail } from "./email-delivery";

export function smtpConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.EMAIL_DELIVERY_PROVIDER !== "smtp") return undefined;

  const host = env.SMTP_HOST;
  if (!host || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(host)) {
    throw new Error("SMTP_HOST must be a valid hostname.");
  }
  const port = Number(env.SMTP_PORT);
  if (!/^\d+$/.test(env.SMTP_PORT ?? "") || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }
  if (env.SMTP_SECURE !== "true" && env.SMTP_SECURE !== "false") {
    throw new Error("SMTP_SECURE must be true or false.");
  }
  const secure = env.SMTP_SECURE === "true";
  const mailbox = z.string().email().max(254);
  const user = mailbox.safeParse(env.SMTP_USER);
  const from = mailbox.safeParse(env.SMTP_FROM_EMAIL);
  if (!user.success) throw new Error("SMTP_USER must be a valid email address.");
  if (!from.success) throw new Error("SMTP_FROM_EMAIL must be a valid email address.");
  const pass = env.SMTP_PASS;
  if (!pass?.trim() || /[\r\n]/.test(pass)) throw new Error("SMTP_PASS is required.");

  return { host, port, secure, user: user.data, pass, from: from.data };
}

type SmtpConfig = NonNullable<ReturnType<typeof smtpConfiguration>>;

export class SmtpEmailDeliveryProvider implements EmailDeliveryProvider {
  private readonly transport;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      forceAuth: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      auth: { user: config.user, pass: config.pass },
      dnsTimeout: 10_000,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
    });
  }

  async verify(): Promise<void> {
    try {
      if (await this.transport.verify()) return;
    } catch {
      // SMTP diagnostics can contain provider or credential details.
    }
    throw new Error("SMTP connection or authentication failed.");
  }

  async send(message: OutboundEmail): Promise<void> {
    try {
      const result = await this.transport.sendMail({
        from: this.config.from, to: message.to, subject: message.subject, text: message.text,
      });
      if (result.accepted.length > 0 && result.rejected.length === 0) return;
    } catch {
      // Keep SMTP diagnostics and message contents out of application errors.
    }
    throw new Error("SMTP email delivery failed.");
  }
}
