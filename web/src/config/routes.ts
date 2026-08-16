export const routes = {
  publicHome: "/",
  login: "/login",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyMfa: "/verify-mfa",
  acceptInvitation: "/accept-invitation",
  adminDashboard: "/dashboard",
  organization: "/organization",
  organizationMembers: "/organization/members",
  superAdminDashboard: "/super-admin/dashboard",
  unauthorized: "/unauthorized",
  designSystem: "/design-system",
} as const;

/**
 * Les écrans d'authentification.
 *
 * Une session déjà ouverte y est renvoyée vers le tableau de bord : rester sur
 * un formulaire de connexion alors qu'on est connecté n'a pas de sens, et
 * s'y reconnecter ferait tourner la session pour rien.
 */
const AUTHENTICATION_PATHS: readonly string[] = [
  routes.login,
  routes.forgotPassword,
  routes.resetPassword,
  routes.verifyMfa,
];

/**
 * Ce qui reste atteignable sans session.
 *
 * `acceptInvitation` en fait partie et ce n'est pas un oubli : une invitation
 * s'accepte précisément quand on n'a pas encore de compte. La rediriger vers
 * la connexion rendrait le lien d'invitation inutilisable.
 *
 * `/design-system` y figure pour que la recette visuelle reste consultable
 * sans être connecté — c'est elle qui sert à mettre au point l'écran de
 * connexion lui-même, et exiger une session pour y accéder serait circulaire.
 */
const PUBLIC_PATHS: readonly string[] = [
  routes.publicHome,
  routes.acceptInvitation,
  routes.unauthorized,
  routes.designSystem,
  ...AUTHENTICATION_PATHS,
];

const startsWithPath = (pathname: string, base: string): boolean =>
  pathname === base || pathname.startsWith(`${base}/`);

/** Vrai pour un écran de connexion, de MFA ou de mot de passe. */
export function isAuthenticationPath(pathname: string): boolean {
  return AUTHENTICATION_PATHS.some((base) => startsWithPath(pathname, base));
}

/**
 * Vrai pour tout ce qui n'est pas déclaré public.
 *
 * Le sens du test compte : la liste énumère ce qui est **ouvert**, et tout le
 * reste est protégé. L'inverse — énumérer ce qui est protégé — laisserait
 * chaque nouvelle route ouverte par défaut, c'est-à-dire au premier oubli.
 */
export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PATHS.some((base) => startsWithPath(pathname, base));
}
