"use client";

import type { ComponentProps, ReactNode } from "react";
import type { FieldError } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = ComponentProps<typeof Input> & {
  readonly id: string;
  readonly label: string;
  readonly error?: FieldError;
  readonly hint?: ReactNode;
};

/**
 * Un champ, son libellé, son message d'erreur — et le câblage d'accessibilité
 * qui les relie.
 *
 * Extrait parce que ce triplet apparaît neuf fois dans les quatre formulaires
 * d'authentification, et que les trois attributs qui comptent — `htmlFor`,
 * `aria-invalid`, `aria-describedby` — sont précisément ceux qu'on oublie en
 * recopiant. Un `aria-describedby` manquant rend le message invisible aux
 * lecteurs d'écran : le champ est signalé en erreur sans que la raison soit
 * jamais annoncée.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  ...inputProps
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
