"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";

import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { LOCALES, type Locale } from "@/i18n/config";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Le changement de langue — EVT-047.
 *
 * ## 🔴 `usePathname` vient de `@/i18n/navigation`, pas de `next/navigation`
 *
 * Celui de Next rend le chemin **avec** son préfixe : depuis `/en/organization`
 * il rend `/en/organization`, et repousser vers la locale `fr` produirait
 * `/fr/en/organization`. Celui de `next-intl` rend `/organization`, c'est-à-dire
 * le chemin indépendant de la langue — le seul sur lequel un changement de
 * locale a du sens.
 *
 * ## Les paramètres de route sont réinjectés
 *
 * `usePathname` rend le motif (`/events/[id]`), pas l'adresse résolue. Sans
 * `params`, changer de langue depuis la fiche d'un événement atterrirait
 * littéralement sur `/events/[id]`. Aucune route dynamique n'existe encore côté
 * admin, mais le sprint 09 en apporte, et découvrir ce défaut là-bas coûterait
 * plus cher que de l'écrire ici.
 *
 * ## Une transition, parce que la navigation est asynchrone
 *
 * `router.replace` déclenche un rendu serveur. Sans `useTransition` le
 * sélecteur revient visuellement à l'ancienne valeur le temps de l'aller-retour,
 * ce qui donne l'impression que le clic n'a pas pris.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("locale");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <NativeSelect
      size="sm"
      className={className}
      value={locale}
      disabled={isPending}
      aria-label={t("label")}
      onChange={(event) => {
        const next = event.target.value as Locale;

        startTransition(() => {
          router.replace(
            // @ts-expect-error — `pathname` est un motif de route typé par
            // `next-intl` ; les paramètres qui le complètent ne sont connus
            // qu'à l'exécution. La documentation de la bibliothèque prescrit
            // exactement cette suppression pour ce cas.
            { pathname, params },
            { locale: next },
          );
        });
      }}
    >
      {LOCALES.map((option) => (
        <NativeSelectOption key={option} value={option}>
          {t(option)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
