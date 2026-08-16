import { ApplicationShell, AuthGuard } from "@/features/authentication";

/**
 * Toutes les pages authentifiées passent par ici.
 *
 * `AuthGuard` d'abord, `ApplicationShell` ensuite : la coque lit les
 * permissions effectives pour filtrer sa navigation, et les lire avant que la
 * session ne soit vérifiée afficherait brièvement une barre latérale vide
 * avant la redirection.
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard>
      <ApplicationShell>{children}</ApplicationShell>
    </AuthGuard>
  );
}
