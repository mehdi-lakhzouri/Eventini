import type { Request } from 'express';

/** `RequestIdMiddleware` stamps every request with this before anything else runs. */
export interface RequestWithId extends Request {
  id: string;
}
