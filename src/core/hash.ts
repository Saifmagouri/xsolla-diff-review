import { createHash } from 'node:crypto';

/** SHA-256 hex digest, used to key idempotency and cache on the raw request body. */
export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}
