import { z } from "zod";

import type { ValidationTranslator } from "./validation-translator";

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
export function buildLoginSchema(t: ValidationTranslator) {
  return z.object({
    email: z.string().min(1, t("emailRequired")).email(t("emailInvalid")),
    password: z.string().min(1, t("passwordRequired")),
  });
}

export type LoginFormValues = z.infer<ReturnType<typeof buildLoginSchema>>;
