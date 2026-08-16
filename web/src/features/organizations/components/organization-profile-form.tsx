"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import { applyApiErrorToForm, usePermissions } from "@/features/authentication";
import { ApiError } from "@/lib/api/api-error";
import { useOrganizationProfile, useUpdateOrganization } from "../hooks";
import {
  organizationProfileSchema,
  type OrganizationProfileInput,
} from "../schemas/organization.schema";

/**
 * Les réglages de l'organisation — EVT-046, sur EVT-042 et EVT-032.
 *
 * ## Le conflit de version a son propre message
 *
 * `PATCH` répond `409` quand quelqu'un d'autre a enregistré entre la lecture et
 * l'écriture. Le message par défaut du backend décrirait le mécanisme ; ce
 * qu'il faut dire à l'utilisateur, c'est **quoi faire** — recharger, relire, et
 * réappliquer. Sans cela il réessaierait à l'identique et échouerait à
 * l'identique.
 */
export function OrganizationProfileForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const { data, isPending, isError } = useOrganizationProfile(organizationId);
  const update = useUpdateOrganization(organizationId);
  const { can } = usePermissions();
  const [saved, setSaved] = useState(false);

  const canManage = can(permissions.manageOrganization);

  const form = useForm<OrganizationProfileInput>({
    resolver: zodResolver(organizationProfileSchema),
    defaultValues: { name: "", slug: "" },
  });

  const { reset } = form;
  const organization = data?.organization;

  /*
    Le formulaire est réinitialisé quand la fiche arrive, et à chaque fois
    qu'elle change. Passer par `defaultValues` seul ne suffirait pas : ils sont
    lus au premier rendu, alors que la requête est encore en vol, et les champs
    resteraient vides.
  */
  useEffect(() => {
    if (organization !== undefined) {
      reset({ name: organization.name, slug: organization.slug });
    }
  }, [organization, reset]);

  if (isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">Chargement de l&apos;organisation…</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError || organization === undefined) {
    return (
      <p role="alert" className="text-sm text-destructive">
        La fiche de l&apos;organisation n&apos;a pas pu être chargée.
      </p>
    );
  }

  const onSubmit = form.handleSubmit((values) => {
    setSaved(false);
    update.mutate(values, {
      onSuccess: () => setSaved(true),
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          form.setError("root", {
            message:
              "Quelqu'un d'autre a modifié cette organisation entre-temps. Rechargez la page pour repartir de la version à jour.",
          });
          return;
        }

        applyApiErrorToForm(error, form.setError, {
          knownFields: ["name", "slug"],
        });
      },
    });
  });

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="organization-name">Nom</Label>
        <Input
          id="organization-name"
          disabled={!canManage}
          aria-invalid={form.formState.errors.name !== undefined}
          {...form.register("name")}
        />
        {form.formState.errors.name ? (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.name.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="organization-slug">Identifiant</Label>
        <Input
          id="organization-slug"
          disabled={!canManage}
          aria-describedby="organization-slug-help"
          aria-invalid={form.formState.errors.slug !== undefined}
          {...form.register("slug")}
        />
        <p id="organization-slug-help" className="text-sm text-muted-foreground">
          Minuscules, chiffres et tirets. Il apparaît dans les adresses.
        </p>
        {form.formState.errors.slug ? (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.slug.message}
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Formule</dt>
          <dd className="font-medium">{organization.licensePlan}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Statut</dt>
          <dd className="font-medium">{organization.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Membres autorisés</dt>
          <dd className="font-medium">{organization.userLimit ?? "Illimité"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Événements autorisés</dt>
          <dd className="font-medium">{organization.eventLimit ?? "Illimité"}</dd>
        </div>
      </dl>

      {form.formState.errors.root ? (
        <p role="alert" className="text-sm text-destructive">
          {form.formState.errors.root.message}
        </p>
      ) : null}

      {saved ? (
        <p role="status" className="text-sm text-success">
          Modifications enregistrées.
        </p>
      ) : null}

      {canManage ? (
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Vous pouvez consulter ces informations, mais pas les modifier.
        </p>
      )}
    </form>
  );
}
