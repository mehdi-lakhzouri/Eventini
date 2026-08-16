import type fr from "../../messages/fr.json";

/**
 * Le catalogue français fait foi pour le typage — EVT-047.
 *
 * ## 🔴 Ce que cela transforme en erreur de compilation
 *
 * Sans cette déclaration, `t("navigaton.dashboard")` — la faute de frappe est
 * volontaire — compile parfaitement et rend la clé brute à l'écran. De même,
 * une clé retirée de `fr.json` laisse ses appelants intacts jusqu'à ce que
 * quelqu'un ouvre la page.
 *
 * Avec elle, les deux échouent au `typecheck`.
 *
 * ## Pourquoi le français et pas l'anglais
 *
 * Il faut un catalogue de référence, et ce doit être celui qui est **toujours
 * complet** : c'est la langue par défaut, donc celle qu'un écran rend quand
 * l'autre est en retard. Prendre `en.json` comme source rendrait une clé
 * française non traduite invisible au typage — exactement le sens de l'erreur
 * qu'on ne veut pas.
 *
 * L'écart inverse — une clé présente en français, absente en anglais — n'est
 * pas attrapé ici. C'est le rôle du test de parité des catalogues.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof fr;
  }
}
