import type { Response } from 'express';

/** Machine codes from SPEC.md's error taxonomy. */
export type ErrorCode =
  | 'unauthorized'
  | 'payload_too_large'
  | 'invalid_json'
  | 'invalid_diff'
  | 'idempotency_conflict'
  | 'not_found'
  | 'rate_limited'
  | 'internal';

/** Thrown anywhere in the request path; mapped to the error envelope by the handler. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

/** Single choke point for writing the error envelope. Never double-sends. */
export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
): void {
  if (res.headersSent) return;
  res.status(status).json(errorBody(code, message));
}
