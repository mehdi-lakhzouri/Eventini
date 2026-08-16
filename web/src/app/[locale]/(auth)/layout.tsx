import { AuthBrandPanel } from "@/features/authentication";

/**
 * Le gabarit d'authentification — panneau de marque à gauche, formulaire à
 * droite. Spécifié par `DESIGN_SYSTEM.md` §7 (EVT-075, ADR-0019).
 *
 * Server Component : ce cadre n'a aucun état. Seuls les formulaires eux-mêmes
 * franchissent la frontière client, ce qui garde le dégradé, le texte et la
 * mise en page hors du bundle envoyé au navigateur.
 *
 * Sous 1024px le panneau disparaît entièrement plutôt que de se replier
 * au-dessus du formulaire : sur mobile, l'écran utile est déjà court, et faire
 * défiler un visuel avant d'atteindre le champ d'adresse est une gêne pour un
 * gain nul.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="grid min-h-dvh bg-[#fafbfd] lg:grid-cols-2">
      <AuthBrandPanel />

      <main className="flex min-h-dvh items-center justify-center bg-[#fafbfd] px-0 py-8 text-[#0f172a] sm:px-10 sm:py-10">
        <div className="w-full max-w-sm has-[.eventini-auth-card]:max-w-[614px]">
          {children}
        </div>
      </main>
    </div>
  );
}
