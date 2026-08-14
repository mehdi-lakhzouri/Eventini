import { describe, expect, it } from "vitest";

import { isAuthenticationPath, isProtectedPath, routes } from "./routes";

/**
 * Les prédicats qui pilotent `proxy.ts`.
 *
 * Ils décident d'une redirection d'ergonomie, jamais d'une autorisation
 * (AUTH-INV-011). Mais une erreur ici est visible de tous : ouvrir une page
 * qui n'aurait pas dû l'être renvoie l'utilisateur vers un écran vide, et
 * fermer une page publique rend un lien d'invitation inutilisable.
 */

describe("isProtectedPath", () => {
  /**
   * 🔴 Le sens du test compte. La liste énumère ce qui est **ouvert**, donc
   * toute route nouvelle est protégée par défaut. Énumérer l'inverse laisserait
   * chaque page ajoutée ouverte au premier oubli.
   */
  it("protège une route inconnue, sans avoir à la déclarer", () => {
    expect(isProtectedPath("/events")).toBe(true);
    expect(isProtectedPath("/participants/prt_01JABC")).toBe(true);
    expect(isProtectedPath("/une-page-qui-nexiste-pas-encore")).toBe(true);
  });

  it("protège le tableau de bord et l'espace super-admin", () => {
    expect(isProtectedPath(routes.adminDashboard)).toBe(true);
    expect(isProtectedPath(routes.superAdminDashboard)).toBe(true);
  });

  it("laisse passer les écrans d'authentification", () => {
    for (const path of [
      routes.login,
      routes.forgotPassword,
      routes.resetPassword,
      routes.verifyMfa,
    ]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  /**
   * Une invitation s'accepte précisément quand on n'a pas encore de compte.
   * La protéger rendrait le lien d'invitation inutilisable.
   */
  it("laisse passer l'acceptation d'invitation", () => {
    expect(isProtectedPath(routes.acceptInvitation)).toBe(false);
    expect(isProtectedPath("/accept-invitation/inv_01JABC")).toBe(false);
  });

  /**
   * La recette visuelle sert à mettre au point l'écran de connexion lui-même :
   * exiger une session pour y accéder serait circulaire.
   */
  it("laisse passer la recette de design system", () => {
    expect(isProtectedPath(routes.designSystem)).toBe(false);
  });

  it("laisse passer la racine publique", () => {
    expect(isProtectedPath(routes.publicHome)).toBe(false);
  });

  it("laisse passer la page d'accès refusé, sinon la redirection boucle", () => {
    expect(isProtectedPath(routes.unauthorized)).toBe(false);
  });

  /**
   * Le préfixe doit s'arrêter à une frontière de segment. Sans cela,
   * `/login-attempts` — une route d'administration plausible — passerait pour
   * publique parce qu'elle commence par `/login`.
   */
  it("ne confond pas un préfixe avec un segment", () => {
    expect(isProtectedPath("/login-attempts")).toBe(true);
    expect(isProtectedPath("/dashboards-publics")).toBe(true);
    expect(isProtectedPath("/login/mfa")).toBe(false);
  });
});

describe("isAuthenticationPath", () => {
  it("reconnaît les quatre écrans d'authentification", () => {
    expect(isAuthenticationPath(routes.login)).toBe(true);
    expect(isAuthenticationPath(routes.forgotPassword)).toBe(true);
    expect(isAuthenticationPath(routes.resetPassword)).toBe(true);
    expect(isAuthenticationPath(routes.verifyMfa)).toBe(true);
  });

  /**
   * L'acceptation d'invitation n'en fait pas partie : une session ouverte ne
   * doit pas en être expulsée. Un utilisateur connecté peut légitimement
   * accepter une invitation vers une seconde organisation.
   */
  it("n'y range pas l'acceptation d'invitation", () => {
    expect(isAuthenticationPath(routes.acceptInvitation)).toBe(false);
  });

  it("n'y range pas le tableau de bord", () => {
    expect(isAuthenticationPath(routes.adminDashboard)).toBe(false);
  });

  it("ne confond pas un préfixe avec un segment", () => {
    expect(isAuthenticationPath("/login-attempts")).toBe(false);
  });
});
