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
export { TenantAccessModule, AllowsOrganizationSwitch } from './tenant-access';
export { TenantContextService } from './tenant-access/tenant-context.service';

/**
 * Les décorateurs d'autorisation — ajoutés au sprint 08 (EVT-042).
 *
 * Un module métier qui expose une route en a besoin des deux : `RequirePermission`
 * pour déclarer ce qu'elle exige, `CurrentContext` pour lire le tenant que le
 * guard a résolu. Les laisser hors de la surface obligerait chaque feature à
 * importer un chemin profond dans `identity/authorization`, ce que
 * `modularity.spec.ts` interdit — et ce que cette liste existe pour rendre
 * inutile.
 */
export {
  CurrentCaller,
  CurrentContext,
  RequireAuthLevel,
  RequirePermission,
  type PermissionScope,
} from './authorization/decorators';

/**
 * Le hacheur de mot de passe — ajouté au sprint 08 (EVT-043).
 *
 * L'acceptation d'invitation crée un compte, donc pose un premier mot de
 * passe. Le paramétrage Argon2id d'ADR-0007 doit être **le même** partout :
 * réimplémenter un hachage dans le module organisations reviendrait à créer un
 * second profil de coût, qui divergerait au premier ajustement.
 */
export { PasswordHasher } from './passwords/domain/password-hasher';
export { PasswordsModule } from './passwords';

/**
 * Le compteur de version des permissions — ajouté au sprint 08 (EVT-044).
 *
 * Tout module métier qui change un rôle, un membership ou le statut d'une
 * organisation doit l'incrémenter **dans la même transaction** : c'est ce qui
 * rend la révocation immédiate au lieu d'attendre le TTL du cache (ADR-0004).
 * Le laisser hors de la surface publique obligerait chaque feature à importer
 * un chemin profond dans `identity/authorization`, que `modularity.spec.ts`
 * interdit.
 */
export { PermissionsVersionStore } from './authorization/domain/permissions-version.store';
export { AuthorizationModule } from './authorization/authorization.module';

/**
 * Le lecteur de contexte d'autorisation — ajouté au sprint 08 (EVT-044).
 *
 * Le journal d'audit enregistre le rôle de l'acteur **au moment de l'action**,
 * et le `Caller` ne le porte pas : il s'arrête aux étapes 1 à 3 de la chaîne.
 * Résoudre ce rôle demande la lecture qu'EVT-039 a déjà construite.
 */
export {
  AuthorizationContextReader,
  type AuthorizationContext,
} from './authentication/domain/authorization-context.reader';
