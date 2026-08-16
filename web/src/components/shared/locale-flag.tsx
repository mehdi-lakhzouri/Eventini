import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";

/**
 * Les drapeaux, dessinés en SVG — EVT-047.
 *
 * ##  Pourquoi pas les emojis drapeaux
 *
 * **Windows n'embarque aucun glyphe de drapeau.** `🇫🇷` y est rendu par les
 * deux lettres indicatives « FR », pas par un drapeau — l'équipe développe sous
 * Windows, donc le composant y aurait été cassé en permanence tout en
 * paraissant correct sur les captures d'écran faites ailleurs.
 *
 * Le SVG rend la même chose partout, reste net à toute taille et ne coûte
 * aucune dépendance.
 *
 * ## Une bordure, parce que le blanc disparaît
 *
 * Les deux drapeaux contiennent du blanc, et le menu a un fond clair. Sans le
 * liseré, la bande blanche du drapeau français se fond dans le fond et il ne
 * reste qu'un bleu et un rouge flottants. `ring-inset` plutôt qu'une bordure
 * extérieure : la taille du drapeau reste exactement celle demandée.
 *
 * ## Ce que ces drapeaux ne prétendent pas dire
 *
 * Une langue n'est pas un pays — un francophone belge et un anglophone
 * canadien ne sont représentés par aucun des deux. Le drapeau est ici un repère
 * visuel, jamais l'information : le **nom de la langue** l'accompagne toujours,
 * et c'est lui que les lecteurs d'écran annoncent, le SVG étant marqué
 * `aria-hidden`.
 */
const FLAGS: Record<Locale, React.ReactNode> = {
  fr: (
    <>
      <rect width="20" height="40" fill="#002395" />
      <rect x="20" width="20" height="40" fill="#FFFFFF" />
      <rect x="40" width="20" height="40" fill="#ED2939" />
    </>
  ),
  en: (
    <>
      <rect width="60" height="40" fill="#012169" />
      {/* Les diagonales blanches, puis les rouges par-dessus, plus fines. */}
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#FFFFFF" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" strokeWidth="4" />
      {/* La croix de saint Georges, même construction. */}
      <path d="M30,0 V40 M0,20 H60" stroke="#FFFFFF" strokeWidth="13" />
      <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="8" />
    </>
  ),
};

export function LocaleFlag({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 60 40"
      className={cn(
        "h-3.5 w-5 shrink-0 rounded-[2px] ring-1 ring-inset ring-foreground/15",
        className,
      )}
      aria-hidden="true"
      focusable="false"
    >
      {FLAGS[locale]}
    </svg>
  );
}
