"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";

import { LocaleFlag } from "@/components/shared/locale-flag";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, type Locale } from "@/i18n/config";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Le changement de langue — EVT-047.
 *
 * ## 🔴 `usePathname` vient de `@/i18n/navigation`, pas de `next/navigation`
 *
 * Celui de Next rend le chemin **avec** son préfixe : depuis `/en/organization`
 * il rend `/en/organization`, et repousser vers `fr` produirait
 * `/fr/en/organization`. Celui de `next-intl` rend `/organization`, le chemin
 * indépendant de la langue — le seul sur lequel un changement de locale a du
 * sens.
 *
 * ## Les paramètres de route sont réinjectés
 *
 * `usePathname` rend le **motif** (`/events/[id]`), pas l'adresse résolue. Sans
 * `params`, changer de langue depuis la fiche d'un événement atterrirait
 * littéralement sur `/events/[id]`. Aucune route dynamique n'existe encore côté
 * admin, mais le sprint 09 en apporte, et découvrir ce défaut là-bas coûterait
 * plus cher que de l'écrire ici.
 *
 * ## `render={<Button/>}`, pas un `<Button>` imbriqué
 *
 * `DropdownMenuTrigger` de Base UI rend **lui-même** un `<button>`. Y placer un
 * `<Button>` en enfant produit un bouton dans un bouton : HTML invalide, et le
 * clic peut atterrir sur l'élément intérieur sans jamais parvenir au
 * déclencheur. La prop `render` fusionne les deux en un seul élément — c'est le
 * motif prescrit par la bibliothèque, et l'explication la plus probable des
 * menus « qui ne s'ouvrent pas ».
 *
 * ## Une transition, parce que la navigation est asynchrone
 *
 * `router.replace` déclenche un rendu serveur. Sans `useTransition`, le
 * déclencheur revient visuellement à l'ancienne langue le temps de
 * l'aller-retour, ce qui donne l'impression que le clic n'a pas pris.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("locale");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const switchTo = (next: Locale) => {
    if (next === locale) {
      return;
    }

    startTransition(() => {
      router.replace(
        // @ts-expect-error — `pathname` est un motif de route typé par
        // `next-intl` ; les paramètres qui le complètent ne sont connus qu'à
        // l'exécution. La documentation de la bibliothèque prescrit exactement
        // cette suppression pour ce cas.
        { pathname, params },
        { locale: next },
      );
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="locale-switcher"
        aria-label={t("label")}
        disabled={isPending}
        render={<Button variant="outline" size="sm" />}
        className={cn("gap-2", className)}
      >
        <LocaleFlag locale={locale} />
        <span className="uppercase">{locale}</span>
        <ChevronDownIcon className="size-4 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-44">
        {LOCALES.map((option) => (
          <DropdownMenuItem
            key={option}
            data-testid={`locale-option-${option}`}
            onClick={() => switchTo(option)}
            className="gap-2.5"
          >
            <LocaleFlag locale={option} />
            <span className="flex-1">{t(option)}</span>
            {option === locale ? (
              <CheckIcon className="size-4" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
