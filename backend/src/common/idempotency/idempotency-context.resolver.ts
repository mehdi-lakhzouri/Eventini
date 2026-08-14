import type { Request } from 'express';

import type { TenantContext } from '../types/tenant-context';

/**
 * How the interceptor learns whose key it is holding.
 *
 * A port rather than a direct call into the identity module, and the direction
 * is the reason: the idempotency mechanism is `common/`, it must not know
 * which module authenticates. The adapter over `CallerResolver` lives in
 * `modules/identity/authentication` and is bound in `IdempotencyModule`.
 *
 * `resolve` runs after authentication and before the handler — the scope
 * includes `organizationId` and `actorId`, and neither exists earlier (§12).
 *
 * When EVT-036's global guard lands and puts the resolved context on the
 * request, this becomes a property read and the adapter disappears. It is a
 * port now so that the disappearance is a one-file change.
 *
 * Returns `null` for a caller who is authenticated but carries no
 * organization — a platform session (ADR-0002). It throws, rather than
 * returning `null`, when the caller cannot be authenticated at all: those are
 * two different answers and the interceptor gives them two different statuses.
 */
export abstract class IdempotencyContextResolver {
  abstract resolve(request: Request): Promise<TenantContext | null>;
}
