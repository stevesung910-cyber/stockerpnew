import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { Prisma, RegistrationRequest } from "../../database/generated";
import { prisma } from "../../database/prisma";
import { registrationConfiguration } from "../../config/env";
import { AUDIT_ACTIONS } from "../audit/audit.constants";
import { writeAuditEvent } from "../audit/audit.service";
import { configuredEmailProvider, deliverEmail } from "./email-delivery";
import { hashPassword, newOpaqueToken, tokenDigest } from "./password";
import { allowRegistrationNotification } from "./rate-limit";

export const OTP_LIFETIME_MS = 5 * 60_000;
export const RESEND_COOLDOWN_MS = 60_000;
const REQUEST_LIFETIME_MS = 24 * 60 * 60_000;
const MAX_FAILURES = 5;

type RegistrationInput = { email: string; displayName: string; password: string };
type AuditContext = { requestId: string; ipAddress: string | null };
type Dispatch = {
  config: NonNullable<ReturnType<typeof deliveryConfiguration>>;
  id: string;
  version: number;
  otp: string;
  email: string;
  displayName: string;
};

export function registrationAuditContext(req: Request): AuditContext {
  return { requestId: req.requestId, ipAddress: req.ip ?? req.socket.remoteAddress ?? null };
}

function event(context: AuditContext, action: string, targetId: string | null, outcome: "SUCCESS" | "FAILURE") {
  return { ...context, action, targetType: "RegistrationRequest", targetId, outcome };
}

function deliveryConfiguration() {
  try {
    const provider = configuredEmailProvider();
    if (provider) return { ...registrationConfiguration(), provider };
  } catch {
    // The client receives the same configuration error for any email address.
  }
  return null;
}

function requireDeliveryConfiguration() {
  const config = deliveryConfiguration();
  if (!config) throw Object.assign(new Error("Registration email delivery is not configured. Contact the software owner."), { status: 503, code: "REGISTRATION_UNAVAILABLE" });
  return config;
}

function otpDigest(key: Buffer, id: string, version: number, otp: string) {
  return createHmac("sha256", key).update(`stockerp:registration:${id}:${version}:${otp}`).digest("hex");
}

function generateOtp() {
  return String(randomInt(100_000_000)).padStart(8, "0");
}

async function databaseNow(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  return row.now;
}

async function lockRequest(tx: Prisma.TransactionClient, continuation: string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "RegistrationRequest" WHERE "continuationHash" = ${tokenDigest(continuation)} FOR UPDATE
  `;
  return row ? tx.registrationRequest.findUnique({ where: { id: row.id } }) : null;
}

const clearedCredentials = { pendingEmail: null, otpDigest: null, continuationHash: null, passwordHash: null };

export async function startRegistration(input: RegistrationInput, context: AuditContext) {
  const config = requireDeliveryConfiguration();
  const continuation = newOpaqueToken();
  const id = randomUUID();
  const otp = generateOtp();
  const passwordHash = await hashPassword(input.password);
  const dispatch = await prisma.$transaction(async tx => {
    const now = await databaseNow(tx);
    const [existing] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE lower(btrim(email)) = ${input.email} LIMIT 1
    `;
    if (!existing) {
      await tx.registrationRequest.updateMany({
        where: { pendingEmail: input.email, expiresAt: { lte: now } },
        data: clearedCredentials,
      });
      const inserted = await tx.registrationRequest.createMany({
        skipDuplicates: true,
        data: {
          id, email: input.email, pendingEmail: input.email, displayName: input.displayName, passwordHash,
          continuationHash: tokenDigest(continuation), otpDigest: otpDigest(config.hmacKey, id, 1, otp),
          otpExpiresAt: new Date(now.getTime() + OTP_LIFETIME_MS), lastIssuedAt: now,
          expiresAt: new Date(now.getTime() + REQUEST_LIFETIME_MS),
        },
      });
      if (inserted.count) {
        // A competing confirmation can release the reservation while this insert waits.
        const approved = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
        if (approved) {
          await tx.registrationRequest.delete({ where: { id } });
          await writeAuditEvent(tx, event(context, AUDIT_ACTIONS.REGISTRATION_REQUEST_REJECTED, null, "FAILURE"));
          return null;
        }
        await writeAuditEvent(tx, event(context, AUDIT_ACTIONS.REGISTRATION_REQUEST_CREATED, id, "SUCCESS"));
        return { config, id, otp, version: 1, email: input.email, displayName: input.displayName };
      }
    }
    await writeAuditEvent(tx, event(context, AUDIT_ACTIONS.REGISTRATION_REQUEST_REJECTED, null, "FAILURE"));
    return null;
  });
  return { continuation, dispatch };
}

function liveRequest(row: RegistrationRequest | null, now: Date): row is RegistrationRequest {
  return Boolean(row?.pendingEmail && row.otpDigest && row.passwordHash && !row.consumedAt &&
    row.expiresAt > now && row.failedAttempts < MAX_FAILURES);
}

export async function resendRegistration(continuation: string, context: AuditContext) {
  const config = requireDeliveryConfiguration();
  return prisma.$transaction(async tx => {
    const row = await lockRequest(tx, continuation);
    const now = await databaseNow(tx);
    if (!liveRequest(row, now) || now.getTime() - row.lastIssuedAt.getTime() < RESEND_COOLDOWN_MS) return null;
    let otp: string;
    do {
      otp = generateOtp();
    } while (otpDigest(config.hmacKey, row.id, row.challengeVersion, otp) === row.otpDigest);
    const version = row.challengeVersion + 1;
    await tx.registrationRequest.update({
      where: { id: row.id },
      data: {
        challengeVersion: version, otpDigest: otpDigest(config.hmacKey, row.id, version, otp),
        otpExpiresAt: new Date(now.getTime() + OTP_LIFETIME_MS), lastIssuedAt: now, providerAccepted: false,
      },
    });
    await writeAuditEvent(tx, event(context, AUDIT_ACTIONS.REGISTRATION_OTP_RESENT, row.id, "SUCCESS"));
    return { config, id: row.id, version, otp, email: row.email, displayName: row.displayName };
  });
}

async function submitEmail(dispatch: Dispatch) {
  await deliverEmail({
    to: dispatch.config.ownerEmail,
    subject: "StockERP registration approval requested",
    text: [
      `Name: ${JSON.stringify(dispatch.displayName)}`,
      `Registration email: ${JSON.stringify(dispatch.email)}`,
      `Request reference: ${dispatch.id} (code version ${dispatch.version})`,
      `Approval code: ${dispatch.otp}`,
      "The code expires five minutes after issuance. Share it only after reviewing this registration and identifying the requester.",
    ].join("\n"),
  }, dispatch.config.provider);
}

export function dispatchRegistrationNotification(dispatch: Dispatch | null, context: AuditContext) {
  if (!dispatch) return;
  // Do not let transport latency or delivery results distinguish new and duplicate submissions.
  void (async () => {
    let accepted = false;
    try {
      if (await allowRegistrationNotification()) {
        await submitEmail(dispatch);
        accepted = true;
      }
    } catch {
      // Transport diagnostics are deliberately excluded from application and audit output.
    }
    await prisma.$transaction(async tx => {
      await tx.registrationRequest.updateMany({
        where: { id: dispatch.id, challengeVersion: dispatch.version, pendingEmail: { not: null }, consumedAt: null },
        data: { providerAccepted: accepted },
      });
      await writeAuditEvent(tx, event(context, accepted ? AUDIT_ACTIONS.REGISTRATION_NOTIFICATION_DISPATCHED
        : AUDIT_ACTIONS.REGISTRATION_NOTIFICATION_FAILED, dispatch.id, accepted ? "SUCCESS" : "FAILURE"));
    });
  })().catch(() => process.stderr.write("Registration notification status could not be recorded.\n"));
}

export async function confirmRegistration(continuation: string, otp: string, context: AuditContext) {
  const { hmacKey } = requireDeliveryConfiguration();
  return prisma.$transaction(async tx => {
    const row = await lockRequest(tx, continuation);
    const now = await databaseNow(tx);
    if (!liveRequest(row, now) || row.otpExpiresAt <= now || !row.providerAccepted) {
      const expired = row && (row.expiresAt <= now || row.otpExpiresAt <= now);
      await writeAuditEvent(tx, event(context, expired ? AUDIT_ACTIONS.REGISTRATION_OTP_EXPIRED
        : AUDIT_ACTIONS.REGISTRATION_OTP_FAILED, row?.id ?? null, "FAILURE"));
      return false;
    }

    const suppliedDigest = otpDigest(hmacKey, row.id, row.challengeVersion, otp);
    if (!timingSafeEqual(Buffer.from(suppliedDigest, "hex"), Buffer.from(row.otpDigest!, "hex"))) {
      const [updated] = await tx.$queryRaw<{ failedAttempts: number }[]>`
        UPDATE "RegistrationRequest" SET "failedAttempts" = "failedAttempts" + 1, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
        WHERE "id" = ${row.id} AND "failedAttempts" < ${MAX_FAILURES}
          AND LEAST("expiresAt", "otpExpiresAt") > (clock_timestamp() AT TIME ZONE 'UTC')
        RETURNING "failedAttempts"
      `;
      await writeAuditEvent(tx, event(context, updated ? AUDIT_ACTIONS.REGISTRATION_OTP_FAILED
        : AUDIT_ACTIONS.REGISTRATION_OTP_EXPIRED, row.id, "FAILURE"));
      if (updated?.failedAttempts === MAX_FAILURES) {
        await writeAuditEvent(tx, event(context, AUDIT_ACTIONS.REGISTRATION_OTP_EXHAUSTED, row.id, "FAILURE"));
      }
      return false;
    }

    const consumed = await tx.$executeRaw`
      UPDATE "RegistrationRequest" SET "consumedAt" = clock_timestamp() AT TIME ZONE 'UTC',
        "pendingEmail" = NULL, "passwordHash" = NULL, "continuationHash" = NULL, "otpDigest" = NULL
      WHERE "id" = ${row.id} AND "consumedAt" IS NULL AND "failedAttempts" < ${MAX_FAILURES}
        AND LEAST("expiresAt", "otpExpiresAt") > (clock_timestamp() AT TIME ZONE 'UTC')
    `;
    if (consumed !== 1) {
      await writeAuditEvent(tx, event(context, AUDIT_ACTIONS.REGISTRATION_OTP_EXPIRED, row.id, "FAILURE"));
      return false;
    }

    const user = await tx.user.create({
      data: { email: row.email, displayName: row.displayName, passwordHash: row.passwordHash!, ownerApprovedAt: now },
      select: { id: true },
    });
    await tx.registrationRequest.update({ where: { id: row.id }, data: { resultingUserId: user.id } });
    await writeAuditEvent(tx, { ...event(context, AUDIT_ACTIONS.REGISTRATION_APPROVED, row.id, "SUCCESS"), actorUserId: user.id });
    return true;
  });
}
