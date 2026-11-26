import { createHash } from "node:crypto";
import { prisma } from "../../database/prisma";
import type { RateLimitStore } from "./rate-limit";

export class PostgresRateLimitStore implements RateLimitStore {
  async consume(key: string, max: number, windowMs: number) {
    const digest = createHash("sha256").update(key).digest("hex");
    const updated = await prisma.$queryRaw<{ key: string }[]>`
      INSERT INTO "AuthRateLimitBucket" ("key", "count", "expiresAt")
      VALUES (${digest}, 1, (clock_timestamp() AT TIME ZONE 'UTC') + ${windowMs} * INTERVAL '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthRateLimitBucket"."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
          THEN 1 ELSE "AuthRateLimitBucket"."count" + 1 END,
        "expiresAt" = CASE WHEN "AuthRateLimitBucket"."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
          THEN (clock_timestamp() AT TIME ZONE 'UTC') + ${windowMs} * INTERVAL '1 millisecond'
          ELSE "AuthRateLimitBucket"."expiresAt" END
      WHERE "AuthRateLimitBucket"."count" < ${max}
        OR "AuthRateLimitBucket"."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
      RETURNING "key"
    `;
    if (updated.length) return { allowed: true, retryAfterSeconds: 0 };
    const [bucket] = await prisma.$queryRaw<{ retry: number }[]>`
      SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - (clock_timestamp() AT TIME ZONE 'UTC')))))::integer AS retry
      FROM "AuthRateLimitBucket" WHERE "key" = ${digest}
    `;
    return { allowed: false, retryAfterSeconds: bucket?.retry ?? 1 };
  }
}
