export * from './identity.module';

/**
 * Identity's public surface — what another module may depend on.
 *
 * Deliberately a short, named list rather than `export *` over the subtree.
 * `modularity.spec.ts` forbids reaching past this file, so anything not
 * re-exported here is internal by construction, and widening the surface
 * becomes a visible line in a diff rather than an import someone added in
 * passing.
 *
 * Everything below is what an authenticated feature module genuinely needs:
 * who the caller is, how to turn that into a tenant context, how to issue or
 * replace their session, and the CSRF pair that goes with it.
 */
export { AuthenticationModule } from './authentication/authentication.module';
export {
  CallerResolver,
  CallerError,
  type Caller,
} from './authentication/infrastructure/caller.resolver';
export { toCallerException } from './authentication/infrastructure/caller-exception.mapper';
export {
  SessionIssuer,
  type IssuedSession,
  type ResolvedSessionCommand,
} from './authentication/application/session-issuer';
export {
  AuthenticationRepository,
  type AuthenticationCandidate,
} from './authentication/domain/authentication.repository';
export {
  setSessionCookies,
  clearSessionCookies,
  type SessionCookieSettings,
} from './authentication/infrastructure/cookies/session-cookies';
export { CsrfModule, CsrfService } from './csrf';
export { TenantAccessModule } from './tenant-access';
export { TenantContextService } from './tenant-access/tenant-context.service';
