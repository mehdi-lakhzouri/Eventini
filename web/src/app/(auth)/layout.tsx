import Link from "next/link";

import { routes } from "@/config/routes";

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
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside
        className="hidden flex-col justify-between p-10 text-primary-foreground lg:flex"
        style={{ background: "var(--gradient-brand)" }}
      >
        <Link
          href={routes.publicHome}
          className="text-sm font-semibold tracking-tight rounded-sm outline-offset-4"
        >
          Eventini
        </Link>

        <div>
          <p className="text-3xl font-semibold leading-snug tracking-tight">
            Gérez vos événements
            <br />
            de bout en bout.
          </p>
          <p className="mt-4 max-w-sm text-sm opacity-80">
            Inscriptions, sessions, contrôle d&apos;accès et rapports, dans un
            seul produit.
          </p>
        </div>

        {/* Décoratif : n'annonce rien à un lecteur d'écran. */}
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-1.5 w-8 rounded-full bg-white/80" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
        </div>
      </aside>

      <main className="flex items-center justify-center bg-card px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
