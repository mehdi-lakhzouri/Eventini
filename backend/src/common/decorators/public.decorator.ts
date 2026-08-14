import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'eventini:public';

/**
 * Opens a route to unauthenticated callers.
 *
 * The guards are global, so this is the **only** way a route becomes public,
 * and that direction is deliberate. With guards applied route by route, a
 * forgotten decorator produces a silently open endpoint — and nobody
 * investigates a route that returns `200`. With them global, a forgotten
 * decorator produces a `401`, which someone reports within the hour.
 *
 * Every use of this is a line a reviewer can see and question. There should
 * never be many.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
