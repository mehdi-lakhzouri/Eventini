import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComponentGallery } from "./_components/component-gallery";
import { ContrastAudit } from "./_components/contrast-audit";
import { MotionLab } from "./_components/motion-lab";
import { ThemeSwitch } from "./_components/theme-switch";
import { TokenSwatches } from "./_components/token-swatches";

export const metadata: Metadata = {
  title: "Design system — Eventini",
  // Cette page décrit toute la surface d'interface : elle n'a rien à faire dans
  // un index de moteur de recherche, même si elle fuitait en production.
  robots: { index: false, follow: false },
};

/**
 * La recette visuelle vivante — ADR-0019, `docs/design/DESIGN_SYSTEM.md`.
 *
 * Elle existe pour une raison précise : une documentation de design écrite en
 * markdown périme en silence. Les valeurs affichées ici sont relues depuis les
 * tokens réellement appliqués au document, donc la page ne peut pas diverger
 * de `globals.css`. Si un token change, le tableau de contraste change avec.
 *
 * Hors du groupe `(admin)` volontairement : ce groupe portera le `AuthGuard` au
 * sprint 07 (EVT-039), et une recette visuelle qui exige une session ne peut
 * pas servir à mettre au point l'écran de connexion lui-même.
 */
export default function DesignSystemPage() {
  // En production la route répond 404, sauf activation explicite. Le fichier
  // reste dans la sortie de build — Next ne supprime pas une route selon une
  // condition d'exécution — mais rien n'est atteignable ni indexable.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_ENABLE_DESIGN_SYSTEM !== "true"
  ) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-12 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">EVT-075</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Design system Eventini
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Recette visuelle des tokens, du mouvement et des composants. Les
            ratios de contraste ci-dessous sont mesurés au rendu sur les valeurs
            réellement appliquées, pas recopiés depuis la documentation.
          </p>
        </div>
        <ThemeSwitch />
      </header>

      <div className="space-y-16">
        <Section
          id="contraste"
          title="Contraste"
          lead="Exigence AA de FRONTEND_ARCHITECTURE.md §12. Bascule le thème : les mesures se recalculent."
        >
          <ContrastAudit />
        </Section>

        <Section
          id="tokens"
          title="Tokens de couleur"
          lead="Deux jeux, clair et sombre. La valeur affichée est celle que le navigateur applique."
        >
          <TokenSwatches />
        </Section>

        <Section
          id="typographie"
          title="Typographie"
          lead="Geist Sans pour l'interface, Geist Mono pour les identifiants techniques."
        >
          <TypographyScale />
        </Section>

        <Section
          id="mouvement"
          title="Mouvement"
          lead="Registre premium expressif. Active prefers-reduced-motion dans les outils de développement : tout déplacement doit disparaître."
        >
          <MotionLab />
        </Section>

        <Section
          id="authentification"
          title="Gabarit d'authentification"
          lead="Panneau de marque à gauche, formulaire à droite. Sous 1024px le panneau disparaît."
        >
          <AuthTemplatePreview />
        </Section>

        <Section
          id="composants"
          title="Composants"
          lead="Échantillon choisi pour exercer chaque token, pas l'inventaire complet des soixante."
        >
          <ComponentGallery />
        </Section>
      </div>
    </main>
  );
}

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{lead}</p>
      {children}
    </section>
  );
}

const TYPE_SCALE = [
  {
    name: "Display",
    className: "text-4xl font-semibold tracking-tight",
    sample: "Tableau de bord",
  },
  {
    name: "H1",
    className: "text-3xl font-semibold tracking-tight",
    sample: "Organisations",
  },
  {
    name: "H2",
    className: "text-2xl font-semibold tracking-tight",
    sample: "Membres actifs",
  },
  {
    name: "H3",
    className: "text-lg font-semibold",
    sample: "Sessions ouvertes",
  },
  {
    name: "Body",
    className: "text-sm",
    sample: "Un membre peut appartenir à plusieurs organisations.",
  },
  {
    name: "Small",
    className: "text-xs text-muted-foreground",
    sample: "Dernière activité il y a 3 minutes",
  },
] as const;

function TypographyScale() {
  return (
    <div className="space-y-5">
      {TYPE_SCALE.map((entry) => (
        <div
          key={entry.name}
          className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-baseline sm:gap-6"
        >
          <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
            {entry.name}
          </span>
          <span className={entry.className}>{entry.sample}</span>
        </div>
      ))}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
          Mono
        </span>
        {/*
          Les identifiants de requête sont affichés dans les erreurs techniques :
          un utilisateur qui signale « req_01JABC » permet de retrouver la
          requête exacte dans les logs. D'où la police à chasse fixe.
        */}
        <span className="font-mono text-sm">req_01JABCDEF2GHJKMNPQRSTVWX</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Chiffres tabulaires actifs sur les tableaux :{" "}
        <span className="font-medium tabular-nums">1 248</span> et{" "}
        <span className="font-medium tabular-nums">1 111</span> occupent la même
        largeur, donc les colonnes ne tremblent pas au rafraîchissement.
      </p>
    </div>
  );
}

/**
 * Aperçu réduit du gabarit d'authentification, pour valider le dégradé de
 * marque et le contraste du panneau avant que EVT-040 ne construise les vrais
 * formulaires.
 */
function AuthTemplatePreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border shadow-lg">
      <div className="grid min-h-[320px] lg:grid-cols-2">
        <div
          className="hidden flex-col justify-between p-8 text-primary-foreground lg:flex"
          style={{ background: "var(--gradient-brand)" }}
        >
          <span className="text-sm font-semibold tracking-tight">Eventini</span>
          <div>
            <p className="text-2xl font-semibold leading-snug">
              Gérez vos événements
              <br />
              de bout en bout.
            </p>
            <p className="mt-3 max-w-xs text-sm opacity-80">
              Inscriptions, sessions, contrôle d&apos;accès et rapports, dans un
              seul produit.
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center gap-4 bg-card p-8">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight">
              Bon retour
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Connectez-vous pour accéder à votre organisation.
            </p>
          </div>
          <p className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            Aperçu de mise en page uniquement. Le formulaire réel, sa validation
            Zod et le traitement de{" "}
            <span className="font-mono">AUTH_MFA_REQUIRED</span> arrivent avec
            EVT-040.
          </p>
        </div>
      </div>
    </div>
  );
}
