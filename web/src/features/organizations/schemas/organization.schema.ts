import { z } from "zod";

/**
 * Les mêmes bornes que `UpdateOrganizationDto` côté backend.
 *
 * Recopiées, pas devinées : un formulaire plus permissif que le serveur laisse
 * partir une requête qui reviendra en `400`, et un formulaire plus strict
 * interdit ce que l'API accepte. Les deux se voient à l'usage, jamais à la
 * compilation.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Les segments que le routage réserve.
 *
 * La liste vient de `update-organization.dto.ts`. Le backend refuse de toute
 * façon ; la reprendre ici évite d'apprendre le refus après l'envoi.
 */
const RESERVED_SLUGS = new Set([
  "api",
  "admin",
  "app",
  "auth",
  "new",
  "edit",
  "settings",
  "login",
  "logout",
  "signup",
  "register",
  "dashboard",
  "static",
  "public",
  "www",
]);

export const organizationProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères.")
    .max(120, "Le nom ne peut pas dépasser 120 caractères."),
  slug: z
    .string()
    .trim()
    .min(3, "L'identifiant doit contenir au moins 3 caractères.")
    .max(63, "L'identifiant ne peut pas dépasser 63 caractères.")
    .regex(
      SLUG_PATTERN,
      "Minuscules, chiffres et tirets uniquement, sans tiret en début ni en fin.",
    )
    .refine(
      (value) => !RESERVED_SLUGS.has(value),
      "Cet identifiant est réservé par l'application.",
    ),
});

export type OrganizationProfileInput = z.infer<typeof organizationProfileSchema>;

/**
 * L'invitation.
 *
 * 🔴 Pas de `z.string().email()`, volontairement — c'est aussi le choix du
 * backend, qui documente pourquoi : la normalisation d'adresse est faite d'un
 * seul côté, et un validateur d'email plus sévère ici rejetterait des adresses
 * que le serveur accepte. Le format minimal suffit à attraper la faute de
 * frappe évidente sans inventer une règle que personne d'autre n'applique.
 */
export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3, "Renseignez une adresse.")
    .max(320, "L'adresse ne peut pas dépasser 320 caractères.")
    .refine(
      (value) => value.includes("@") && !value.startsWith("@") && !value.endsWith("@"),
      "Cette adresse ne ressemble pas à une adresse électronique.",
    ),
  roleCode: z.string().min(1, "Choisissez un rôle."),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** La raison facultative attachée à une suspension ou à une révocation. */
export const lifecycleReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, "La raison ne peut pas dépasser 500 caractères.")
    .optional(),
});

export type LifecycleReasonInput = z.infer<typeof lifecycleReasonSchema>;
