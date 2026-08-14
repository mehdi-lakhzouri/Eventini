/**
 * Les entrées des routes de mot de passe.
 *
 * 🔴 Les noms de champs sont ceux des DTO backend, vérifiés le 14 août 2026.
 * La version précédente déclarait `resetToken` et `password` ; le backend
 * attend `token` et `newPassword`, et sa validation refuse toute propriété non
 * déclarée — le corps aurait donc été rejeté même sur le bon chemin.
 */
export type ForgotPasswordInput = {
  email: string;
};

export type ResetPasswordInput = {
  /** À usage unique, 30 minutes de durée de vie (ADR-0009). */
  token: string;
  newPassword: string;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};
