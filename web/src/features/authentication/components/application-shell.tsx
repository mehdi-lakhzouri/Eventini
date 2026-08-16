"use client";

import {
  BarChart3Icon,
  Building2Icon,
  CalendarDaysIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";

import {
  AppSidebarLayout,
  type AppSidebarNavSection,
} from "@/components/shared/app-sidebar";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { ThemeModeToggle } from "@/components/shared/theme-mode-toggle";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { OrganizationSwitcher } from "@/features/organizations";
import { useLogout } from "../hooks/use-logout";
import { usePermissions } from "../hooks/use-permissions";
import { EventiniMark } from "./eventini-logo";

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
          href: routes.adminDashboard,
          icon: LayoutDashboardIcon,
          exact: true,
        },
        ...(can(permissions.readEvents)
          ? [
              {
                label: t("events"),
                href: routes.events,
                icon: CalendarDaysIcon,
                disabled: true,
                disabledReason: t("availableInSprint", { sprint: "09" }),
              },
              {
                label: t("eventSessions"),
                href: routes.eventSessions,
                icon: ClipboardListIcon,
                disabled: true,
                disabledReason: t("availableInSprint", { sprint: "09" }),
              },
            ]
          : []),
        ...(can(permissions.readParticipants)
          ? [
              {
                label: t("participants"),
                href: routes.participants,
                icon: UsersIcon,
                disabled: true,
                disabledReason: t("availableInSprint", { sprint: "10" }),
              },
            ]
          : []),
        ...(can(permissions.readRegistrations)
          ? [
              {
                label: t("registrations"),
                href: routes.registrations,
                icon: ReceiptTextIcon,
                disabled: true,
                disabledReason: t("availableInSprint", { sprint: "10" }),
              },
            ]
          : []),
        ...(can(permissions.readReports)
          ? [
              {
                label: t("reports"),
                href: routes.reports,
                icon: BarChart3Icon,
                disabled: true,
                disabledReason: t("availableInSprint", { sprint: "12" }),
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
        {
          label: t("security"),
          href: routes.accountSecurity,
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
          href: routes.accountSessions,
          icon: MonitorSmartphoneIcon,
        },
      ],
    },
  ];

  return (
    <AppSidebarLayout
      brand={{
        name: "Eventini",
        description: t("eventManagement"),
        href: routes.adminDashboard,
        icon: EventiniMark,
      }}
      sections={sections}
      footer={
        <ApplicationSidebarFooter
          displayName={user?.displayName ?? user?.email ?? "Eventini"}
          email={user?.email}
          role={
            user?.role === "SUPER_ADMIN"
              ? t("superAdministrator")
              : t("administrator")
          }
          signOutLabel={t("signOut")}
          isSigningOut={logout.isPending}
          onSignOut={() => logout.mutate()}
        />
      }
    >
      <div className="flex min-h-svh flex-col bg-background">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-background/88 px-4 py-3 backdrop-blur-xl supports-backdrop-filter:bg-background/75 sm:px-6">
          <div className="w-full max-w-[19rem] sm:w-auto sm:flex-1">
            <OrganizationSwitcher />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ThemeModeToggle />
            <LocaleSwitcher />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
          {children}
        </div>
      </div>
    </AppSidebarLayout>
  );
}

type ApplicationSidebarFooterProps = {
  displayName: string;
  email?: string;
  role: string;
  signOutLabel: string;
  isSigningOut: boolean;
  onSignOut: () => void;
};

function ApplicationSidebarFooter({
  displayName,
  email,
  role,
  signOutLabel,
  isSigningOut,
  onSignOut,
}: ApplicationSidebarFooterProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tooltip={displayName}
          render={
            <Link href={routes.accountProfile} aria-label={displayName} />
          }
          className="h-14 rounded-xl border border-sidebar-border/70 bg-sidebar-accent/55 p-2 shadow-xs hover:bg-sidebar-accent"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground shadow-sm">
            {initials(displayName)}
          </span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-semibold">
              {displayName}
            </span>
            <span className="block truncate text-[0.7rem] text-sidebar-foreground/55">
              {email ?? role}
            </span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={signOutLabel}
          aria-label={signOutLabel}
          disabled={isSigningOut}
          onClick={onSignOut}
          className="h-9 rounded-xl text-sidebar-foreground/65 hover:text-sidebar-foreground"
        >
          <LogOutIcon aria-hidden="true" />
          <span>{signOutLabel}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function initials(displayName: string) {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}
