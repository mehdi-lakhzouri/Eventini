"use client";

import { MonitorIcon, MoonIcon, SunMediumIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/motion-toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", icon: SunMediumIcon },
  { value: "dark", icon: MoonIcon },
  { value: "system", icon: MonitorIcon },
] as const;

type ThemeMode = (typeof THEME_OPTIONS)[number]["value"];

export function ThemeModeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const selectedTheme: ThemeMode = isThemeMode(theme) ? theme : "system";

  return (
    <ToggleGroup
      type="single"
      value={[selectedTheme]}
      onValueChange={(values) => {
        const nextTheme = values.at(-1);

        if (isThemeMode(nextTheme)) {
          setTheme(nextTheme);
        }
      }}
      aria-label={t("label")}
      className={cn(
        "overflow-hidden rounded-full border border-border/70 bg-primary/8 p-0.5 shadow-xs",
        className,
      )}
      spacing={0}
      activeClassName="rounded-full bg-background shadow-sm ring-1 ring-border/70"
    >
      {THEME_OPTIONS.map(({ value, icon: Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger
            render={
              <ToggleGroupItem
                value={value}
                aria-label={t(value)}
                className="h-7 min-w-8 px-0.5 text-muted-foreground group-data-[spacing=0]/toggle-group:px-0.5 data-pressed:text-primary"
                motionProps={{
                  className:
                    "[&_[data-slot=active-toggle-group-item]]:rounded-full",
                }}
              />
            }
          >
            <Icon className="size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={7}>
            {t(value)}
          </TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

function isThemeMode(value: string | undefined): value is ThemeMode {
  return THEME_OPTIONS.some((option) => option.value === value);
}
