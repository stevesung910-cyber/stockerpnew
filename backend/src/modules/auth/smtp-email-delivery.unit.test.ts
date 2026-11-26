import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { validateRuntimeEnvironment } from "../../config/env";
import { prisma } from "../../database/prisma";
import { configuredEmailProvider, hasConfiguredEmailProvider } from "./email-delivery";
import { dispatchRegistrationNotification, startRegistration } from "./registration.service";
import { SmtpEmailDeliveryProvider, smtpConfiguration } from "./smtp-email-delivery";

const smtpEnv = {
  EMAIL_DELIVERY_PROVIDER: "smtp",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "sender@example.test",
  SMTP_PASS: randomBytes(12).toString("hex"),
  SMTP_FROM_EMAIL: "sender@example.test",
  REGISTRATION_OWNER_EMAIL: "owner@example.test",
  OWNER_REGISTRATION_OTP_HMAC_SECRET: randomBytes(32).toString("hex"),
};

test("SMTP configuration works in production without HTTP or Gmail OAuth settings", () => {
  assert.doesNotThrow(() => validateRuntimeEnvironment({
    ...smtpEnv, APP_ENV: "production", NODE_ENV: "production",
    FRONTEND_ORIGIN: "https://app.example.test",
    DATABASE_URL: "postgresql://localhost/stockerp_test",
  }));
  for (const [key, value] of Object.entries({
    SMTP_HOST: "https://smtp.gmail.com", SMTP_PORT: "65536", SMTP_SECURE: "yes",
    SMTP_USER: "invalid", SMTP_PASS: "", SMTP_FROM_EMAIL: "a@example.test,b@example.test",
  })) {
    assert.throws(() => smtpConfiguration({ ...smtpEnv, [key]: value }), new RegExp(key));
  }
  assert.throws(() => validateRuntimeEnvironment({ ...smtpEnv, REGISTRATION_OWNER_EMAIL: "" }), /REGISTRATION_OWNER_EMAIL/);
  assert.equal(smtpConfiguration({ EMAIL_DELIVERY_PROVIDER: "http" }), undefined);
});

test("SMTP verify requires STARTTLS and authenticates without sending", async t => {
  const verify = t.mock.fn(async () => true);
  const sendMail = t.mock.fn();
  const create = t.mock.method(nodemailer, "createTransport", () => ({ verify, sendMail }));
  const provider = new SmtpEmailDeliveryProvider(smtpConfiguration(smtpEnv)!);
  const [options] = create.mock.calls[0].arguments;
  assert.deepEqual(options, {
    host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true, forceAuth: true,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: { user: smtpEnv.SMTP_USER, pass: smtpEnv.SMTP_PASS },
    dnsTimeout: 10_000, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    logger: false, debug: false,
  });
  await provider.verify();
  assert.equal(verify.mock.callCount(), 1);
  assert.equal(sendMail.mock.callCount(), 0);

  verify.mock.mockImplementation(async () => { throw new Error(smtpEnv.SMTP_PASS); });
  await assert.rejects(provider.verify(), { message: "SMTP connection or authentication failed." });
  assert.equal(sendMail.mock.callCount(), 0);
});

test("SMTP rejects unaccepted delivery and redacts transport failures", async t => {
  const sendMail = t.mock.fn(async () => ({ accepted: [] as string[], rejected: [smtpEnv.REGISTRATION_OWNER_EMAIL] }));
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));
  const provider = new SmtpEmailDeliveryProvider(smtpConfiguration(smtpEnv)!);
  const message = { to: smtpEnv.REGISTRATION_OWNER_EMAIL, subject: "Test", text: "Mock message" };
  await assert.rejects(provider.send(message), { message: "SMTP email delivery failed." });
  sendMail.mock.mockImplementation(async () => { throw new Error(message.text); });
  await assert.rejects(provider.send(message), { message: "SMTP email delivery failed." });
  assert.equal(sendMail.mock.callCount(), 2);
});

test("registration dispatch sends the HMAC-protected approval OTP only to the configured owner", { timeout: 3_000 }, async t => {
  const previous = new Map(Object.keys(smtpEnv).map(key => [key, process.env[key]]));
  Object.assign(process.env, smtpEnv);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const sendMail = t.mock.fn(async (_message: SendMailOptions) => ({
    accepted: [smtpEnv.REGISTRATION_OWNER_EMAIL], rejected: [],
  }));
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));
  const now = new Date();
  const stored = t.mock.fn(async (_args: { data: { id: string; otpDigest: string; otpExpiresAt: Date } }) => ({ count: 1 }));
  const updated = t.mock.fn(async (_args: { data: { providerAccepted: boolean } }) => ({ count: 1 }));
  const audit = t.mock.fn(async (_args: unknown) => undefined);
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => query[0].includes("clock_timestamp") ? [{ now }] : [],
    user: { findUnique: async () => null },
    registrationRequest: { updateMany: async (_args: { data: { providerAccepted: boolean } }) => ({ count: 0 }), createMany: stored },
    auditEvent: { create: audit },
  };
  let finishRecording!: () => void;
  let failRecording!: (error: unknown) => void;
  const recorded = new Promise<void>((resolve, reject) => {
    finishRecording = resolve;
    failRecording = reject;
  });
  const originalTransaction = prisma.$transaction;
  const transaction = t.mock.fn(async (operation: (db: typeof tx) => Promise<unknown>) => operation(tx));
  prisma.$transaction = transaction as unknown as typeof originalTransaction;
  t.after(() => { prisma.$transaction = originalTransaction; });
  assert.equal(prisma.$transaction, transaction);
  assert.equal(hasConfiguredEmailProvider(), true);
  assert.ok(configuredEmailProvider() instanceof SmtpEmailDeliveryProvider);

  const email = "client@example.test";
  const context = { requestId: "smtp-registration-test", ipAddress: null };
  const { dispatch } = await startRegistration({ email, displayName: "Test client", password: "mock-client-password" }, context);
  assert.ok(dispatch);
  assert.equal(sendMail.mock.callCount(), 0);

  const dispatchTx = { ...tx, registrationRequest: { ...tx.registrationRequest, updateMany: updated } };
  transaction.mock.mockImplementationOnce(async operation => {
    try {
      const result = await operation(dispatchTx);
      finishRecording();
      return result;
    } catch (error) {
      failRecording(error);
      throw error;
    }
  });
  dispatchRegistrationNotification(dispatch, context);
  await recorded;

  assert.equal(sendMail.mock.callCount(), 1);
  const [message] = sendMail.mock.calls[0].arguments;
  assert.equal(message.from, smtpEnv.SMTP_FROM_EMAIL);
  assert.equal(message.to, smtpEnv.REGISTRATION_OWNER_EMAIL);
  assert.match(String(message.text), /Registration email: "client@example\.test"/);
  const otp = String(message.text).match(/Approval code: (\d{8})/)?.[1];
  assert.ok(otp);
  const [{ data }] = stored.mock.calls[0].arguments;
  assert.equal(data.otpDigest, createHmac("sha256", Buffer.from(smtpEnv.OWNER_REGISTRATION_OTP_HMAC_SECRET, "hex"))
    .update(`stockerp:registration:${data.id}:1:${otp}`).digest("hex"));
  assert.equal(data.otpExpiresAt.getTime() - now.getTime(), 5 * 60_000);
  assert.equal(updated.mock.calls[0].arguments[0].data.providerAccepted, true);
  assert.ok(!JSON.stringify(audit.mock.calls.map(call => call.arguments)).includes(`Approval code: ${otp}`));
});
