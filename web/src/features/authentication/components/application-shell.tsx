"use client";

import {
  BarChart3Icon,
  Building2Icon,
  CalendarDaysIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";

import {
  AppSidebarLayout,
  type AppSidebarNavSection,
} from "@/components/shared/app-sidebar";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { OrganizationSwitcher } from "@/features/organizations";
import { useLogout } from "../hooks/use-logout";
import { usePermissions } from "../hooks/use-permissions";

/**
 * La coque applicative — barre latérale, sélecteur d'organisation, déconnexion.
 *
 * `app-sidebar.tsx` fait 558 lignes réelles et n'était **importé par aucune
 * page** (défaut F-11). Ce composant le branche, en remplaçant sa navigation
 * par défaut — en anglais et pointant des routes qui n'existent pas encore —
 * par une navigation filtrée sur les permissions effectives.
 *
 * ## Le filtrage est de l'ergonomie, pas de la sécurité
 *
 * AUTH-INV-011. Masquer une entrée évite de proposer une page qui répondrait
 * 403 ; naviguer directement vers l'URL reste possible, et le backend refuse.
 * C'est pour cela que les permissions consultatives d'EVT-039 suffisent ici
 * alors qu'elles ne suffiraient nulle part ailleurs.
 */
export function ApplicationShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("navigation");
  const { can, data: user } = usePermissions();
  const logout = useLogout();

  const sections: AppSidebarNavSection[] = [
    {
      title: t("workspace"),
      items: [
        {
          label: t("dashboard"),
          href: "/dashboard",
          icon: LayoutDashboardIcon,
          exact: true,
        },
        ...(can(permissions.readEvents)
          ? [
              {
                label: t("events"),
                href: "/events",
                icon: CalendarDaysIcon,
              },
            ]
          : []),
        ...(can(permissions.readParticipants)
          ? [
              {
                label: t("participants"),
                href: "/participants",
                icon: UsersIcon,
              },
            ]
          : []),
        ...(can(permissions.readReports)
          ? [
              {
                label: t("reports"),
                href: "/reports",
                icon: BarChart3Icon,
              },
            ]
          : []),
      ],
    },
    /*
      L'administration de l'organisation — EVT-046.

      La section n'apparaît que si au moins une de ses entrées est visible :
      un titre seul, sans rien dessous, ferait croire à un chargement inachevé.
    */
    ...(can(permissions.readOrganization) || can(permissions.readMembers)
      ? [
          {
            title: t("organization"),
            items: [
              ...(can(permissions.readOrganization)
                ? [
                    {
                      label: t("organizationSettings"),
                      href: routes.organization,
                      icon: Building2Icon,
                      exact: true,
                    },
                  ]
                : []),
              ...(can(permissions.readMembers)
                ? [
                    {
                      label: t("members"),
                      href: routes.organizationMembers,
                      icon: UsersRoundIcon,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    {
      title: t("account"),
      items: [
        { label: t("profile"), href: "/account/profile", icon: UserCircleIcon },
        {
          label: t("security"),
          href: "/account/security",
          icon: ShieldCheckIcon,
        },
        /*
          Toujours visible, sans condition de permission. Gérer ses propres
          sessions n'est pas un privilège accordé par un rôle : c'est le
          minimum qu'un utilisateur doit pouvoir faire sur son propre compte,
          notamment pour couper une session qu'il ne reconnaît pas.
        */
        {
          label: t("sessions"),
          href: "/account/sessions",
          icon: MonitorSmartphoneIcon,
        },
      ],
    },
  ];

  return (
    <AppSidebarLayout
      brand={{
        name: "Eventini",
        description: user?.displayName ?? undefined,
        href: "/dashboard",
        icon: LayoutDashboardIcon,
      }}
      sections={sections}
    >
      <div className="flex flex-col gap-4 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full max-w-xs">
            <OrganizationSwitcher />
          </div>

          <div className="flex items-center gap-2">
            <LocaleSwitcher />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOutIcon aria-hidden="true" />
              {t("signOut")}
            </Button>
          </div>
        </header>

        {children}
      </div>
    </AppSidebarLayout>
  );
}
