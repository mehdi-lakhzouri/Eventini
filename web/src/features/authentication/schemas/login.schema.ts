import { z } from "zod";

/**
 * Validation côté client — **jamais** un remplacement de la validation backend.
 *
 * Elle améliore le retour utilisateur : signaler une adresse malformée avant
 * l'aller-retour évite d'attendre pour rien. Le backend revalide de toute
 * façon, et c'est lui qui décide.
 *
 * `password` n'exige ici qu'un caractère, volontairement. Appliquer la
 * politique de longueur sur un formulaire de **connexion** dirait à l'attaquant
 * que le mot de passe essayé est trop court pour être celui du compte — une
 * information que le backend refuse justement de donner, en traitant une
 * adresse malformée exactement comme un mot de passe faux.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "L'adresse électronique est requise.")
    .email("Cette adresse électronique est invalide."),
  password: z.string().min(1, "Le mot de passe est requis."),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
