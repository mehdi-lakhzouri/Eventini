"use client";

import * as React from "react";
import { Link, usePathname } from "@/i18n/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "eventini:sidebar-open";

export type AppSidebarBrand = {
  name: string;
  href?: string;
  description?: string;
  icon?: LucideIcon;
};

export type AppSidebarNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string | number;
  exact?: boolean;
  disabled?: boolean;
  external?: boolean;
  prefetch?: boolean;
  activeMatch?: string | string[] | ((pathname: string) => boolean);
};

export type AppSidebarNavSection = {
  title?: string;
  items: AppSidebarNavItem[];
};

export const defaultAppSidebarBrand: AppSidebarBrand = {
  name: "Eventini",
  description: "SaaS Console",
  href: "/dashboard",
  icon: CalendarCheckIcon,
};

export const defaultAppSidebarSections: AppSidebarNavSection[] = [
  {
    title: "Workspace",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboardIcon,
        exact: true,
      },
      {
        label: "Events",
        href: "/events",
        icon: CalendarDaysIcon,
      },
      {
        label: "Sessions",
        href: "/sessions",
        icon: ClipboardListIcon,
      },
      {
        label: "Participants",
        href: "/participants",
        icon: UsersIcon,
      },
      {
        label: "Reports",
        href: "/reports",
        icon: BarChart3Icon,
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        label: "Profile",
        href: "/account/profile",
        icon: UserCircleIcon,
      },
      {
        label: "Security",
        href: "/account/security",
        icon: ShieldCheckIcon,
      },
      {
        label: "Settings",
        href: "/settings",
        icon: SettingsIcon,
      },
    ],
  },
];

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  brand?: AppSidebarBrand;
  sections?: AppSidebarNavSection[];
  footerItems?: AppSidebarNavItem[];
  onNavigate?: (item: AppSidebarNavItem) => void;
};

type AppSidebarLayoutProps = {
  children: React.ReactNode;
  brand?: AppSidebarBrand;
  sections?: AppSidebarNavSection[];
  footerItems?: AppSidebarNavItem[];
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
  contentClassName?: string;
  onNavigate?: (item: AppSidebarNavItem) => void;
};

/**
 * The sidebar's open state, persisted across reloads.
 *
 * 🔴 This used to read `localStorage` inside the `useState` initialiser. The
 * server has no `localStorage`, so it rendered `defaultOpen`; the client's
 * first render read the stored value and could disagree — a **hydration
 * mismatch**. React then discards the server markup for the subtree and
 * re-renders it, and until that lands, event handlers on everything inside are
 * not attached.
 *
 * The bug was invisible while this file was dead code (defect F-11). EVT-041
 * wired it, and the first symptom was a dropdown menu inside the layout that
 * simply did not open — with nothing in the UI to suggest why.
 *
 * `useSyncExternalStore` is the supported answer: React renders
 * `getServerSnapshot` during hydration, then switches to `getSnapshot`. The two
 * are allowed to differ, and no markup is thrown away.
 */
function usePersistentSidebarOpen(defaultOpen: boolean, storageKey: string) {
  const subscribe = React.useCallback((onChange: () => void) => {
    // `storage` fires in the *other* tabs. Keeping two windows in agreement is
    // free here, and a sidebar that disagrees with itself across tabs is the
    // kind of small wrongness that erodes trust in the whole interface.
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);

  const getSnapshot = React.useCallback(() => {
    try {
      const savedValue = window.localStorage.getItem(storageKey);
      return savedValue === null ? defaultOpen : savedValue === "true";
    } catch {
      // Unavailable in private or restricted contexts.
      return defaultOpen;
    }
  }, [defaultOpen, storageKey]);

  const open = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultOpen,
  );

  const handleOpenChange = React.useCallback(
    (value: boolean) => {
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // Same restricted contexts; the sidebar still toggles for this session.
      }

      // `storage` does not fire in the tab that wrote it, so the subscriber
      // above would never learn about our own change.
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    },
    [storageKey],
  );

  return [open, handleOpenChange] as const;
}

function isHrefActive(
  pathname: string,
  href: string,
  exact: boolean | undefined,
) {
  if (href === "/") {
    return pathname === "/";
  }

  if (exact) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function isNavItemActive(item: AppSidebarNavItem, pathname: string) {
  if (typeof item.activeMatch === "function") {
    return item.activeMatch(pathname);
  }

  const matches = Array.isArray(item.activeMatch)
    ? item.activeMatch
    : item.activeMatch
      ? [item.activeMatch]
      : [item.href];

  return matches.some((match) => isHrefActive(pathname, match, item.exact));
}

function AppSidebarBrandLink({ brand }: { brand: AppSidebarBrand }) {
  const Icon = brand.icon ?? CalendarCheckIcon;
  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm transition-colors">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 group-data-[collapsible=icon]:hidden">
        <span className="block truncate text-sm font-semibold leading-5">
          {brand.name}
        </span>
        {brand.description ? (
          <span className="block truncate text-xs text-sidebar-foreground/60">
            {brand.description}
          </span>
        ) : null}
      </span>
    </>
  );

  const className =
    "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none group-data-[collapsible=icon]:hidden";

  if (!brand.href) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Link href={brand.href} className={className} aria-label={brand.name}>
      {content}
    </Link>
  );
}

function AppSidebarCollapseButton({
  className,
  onClick,
  "aria-label": ariaLabel,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const isExpanded = isMobile ? openMobile : open;
  const Icon = isMobile ? XIcon : open ? PanelLeftCloseIcon : PanelLeftOpenIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-expanded={isExpanded}
      aria-label={
        ariaLabel ??
        (isMobile
          ? "Fermer la navigation"
          : open
            ? "Reduire la sidebar"
            : "Ouvrir la sidebar")
      }
      className={cn(
        "size-8 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);

        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      {...props}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}

function AppSidebarMobileTrigger({
  className,
  onClick,
  "aria-label": ariaLabel,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { openMobile, toggleSidebar } = useSidebar();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-expanded={openMobile}
      aria-label={ariaLabel ?? "Ouvrir la navigation"}
      className={cn("rounded-lg md:hidden", className)}
      onClick={(event) => {
        onClick?.(event);

        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      {...props}
    >
      <MenuIcon className="size-4" aria-hidden="true" />
    </Button>
  );
}

function AppSidebarNavItem({
  item,
  isActive,
  onNavigate,
}: {
  item: AppSidebarNavItem;
  isActive: boolean;
  onNavigate?: (item: AppSidebarNavItem) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const Icon = item.icon;

  const handleNavigate = React.useCallback(() => {
    onNavigate?.(item);

    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, item, onNavigate, setOpenMobile]);

  if (item.disabled) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          disabled
          aria-disabled="true"
          tooltip={item.label}
          className="h-9 rounded-lg text-sidebar-foreground/40"
        >
          <Icon className="size-4" aria-hidden="true" />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  const linkProps: Pick<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    "aria-current" | "aria-label" | "onClick"
  > = {
    "aria-current": isActive ? "page" : undefined,
    "aria-label": item.label,
    onClick: handleNavigate,
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.label}
        render={
          item.external ? (
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer"
              {...linkProps}
            />
          ) : (
            <Link href={item.href} prefetch={item.prefetch} {...linkProps} />
          )
        }
        className={cn(
          "relative h-9 rounded-lg text-sidebar-foreground/75 transition-colors hover:text-sidebar-foreground",
          isActive &&
            "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary hover:text-sidebar-primary-foreground focus-visible:ring-sidebar-primary/40 before:absolute before:left-1 before:h-5 before:w-1 before:rounded-full before:bg-sidebar-primary-foreground/70 group-data-[collapsible=icon]:before:hidden",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span>{item.label}</span>
      </SidebarMenuButton>
      {item.badge ? (
        <SidebarMenuBadge
          className={cn(
            "right-2 text-sidebar-foreground/50",
            isActive && "text-sidebar-primary-foreground/80",
          )}
        >
          {item.badge}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function AppSidebarNavSection({
  section,
  pathname,
  onNavigate,
}: {
  section: AppSidebarNavSection;
  pathname: string;
  onNavigate?: (item: AppSidebarNavItem) => void;
}) {
  return (
    <SidebarGroup>
      {section.title ? (
        <SidebarGroupLabel className="h-7 rounded-lg px-2 text-[0.68rem] font-semibold uppercase tracking-normal text-sidebar-foreground/50">
          {section.title}
        </SidebarGroupLabel>
      ) : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {section.items.map((item) => (
            <AppSidebarNavItem
              key={`${item.href}-${item.label}`}
              item={item}
              isActive={isNavItemActive(item, pathname)}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AppSidebarNav({
  sections,
  onNavigate,
}: {
  sections: AppSidebarNavSection[];
  onNavigate?: (item: AppSidebarNavItem) => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {sections.map((section, index) => (
        <AppSidebarNavSection
          key={section.title ?? index}
          section={section}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

export function AppSidebar({
  brand = defaultAppSidebarBrand,
  sections = defaultAppSidebarSections,
  footerItems,
  onNavigate,
  className,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar
      collapsible="icon"
      className={cn("border-sidebar-border bg-sidebar", className)}
      {...props}
    >
      <SidebarHeader className="gap-3 p-2">
        <div className="flex min-w-0 items-center gap-1">
          <AppSidebarBrandLink brand={brand} />
          <AppSidebarCollapseButton className="ml-auto shrink-0" />
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="gap-1 py-2">
        <AppSidebarNav sections={sections} onNavigate={onNavigate} />
      </SidebarContent>
      {footerItems?.length ? (
        <>
          <SidebarSeparator />
          <SidebarFooter className="p-2">
            <SidebarMenu>
              {footerItems.map((item) => (
                <AppSidebarNavItem
                  key={`${item.href}-${item.label}`}
                  item={item}
                  isActive={isNavItemActive(item, pathname)}
                  onNavigate={onNavigate}
                />
              ))}
            </SidebarMenu>
          </SidebarFooter>
        </>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}

export function AppSidebarLayout({
  children,
  brand = defaultAppSidebarBrand,
  sections = defaultAppSidebarSections,
  footerItems,
  defaultOpen = true,
  storageKey = SIDEBAR_STORAGE_KEY,
  className,
  contentClassName,
  onNavigate,
}: AppSidebarLayoutProps) {
  const [open, setOpen] = usePersistentSidebarOpen(defaultOpen, storageKey);

  return (
    <TooltipProvider delay={120}>
      <SidebarProvider
        open={open}
        onOpenChange={setOpen}
        defaultOpen={defaultOpen}
        className={cn("min-h-svh bg-background", className)}
      >
        <AppSidebar
          brand={brand}
          sections={sections}
          footerItems={footerItems}
          onNavigate={onNavigate}
        />
        <SidebarInset className={cn("min-w-0", contentClassName)}>
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden">
            <AppSidebarMobileTrigger />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-5">
                {brand.name}
              </p>
              {brand.description ? (
                <p className="truncate text-xs text-muted-foreground">
                  {brand.description}
                </p>
              ) : null}
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export { AppSidebarCollapseButton, AppSidebarMobileTrigger };
