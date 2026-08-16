"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { permissions } from "@/config/permissions";
import { usePermissions } from "@/features/authentication";
import { ApiError } from "@/lib/api/api-error";
import { assignableRoleLabel } from "../constants/assignable-roles";
import { useMemberMutations, useMembers } from "../hooks";
import type { MembershipStatus, OrganizationMember } from "../types";
import { MemberRowActions } from "./member-row-actions";
import { MembershipStatusBadge } from "./membership-status-badge";

const PAGE_SIZE = 10;

const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "Tous les statuts" },
  { value: "ACTIVE", label: "Actifs" },
  { value: "INVITED", label: "Invités" },
  { value: "SUSPENDED", label: "Suspendus" },
  { value: "REVOKED", label: "Révoqués" },
];

function fullName(member: OrganizationMember): string {
  return (
    member.displayName ??
    [member.firstName, member.lastName].filter(Boolean).join(" ").trim() ??
    ""
  );
}

function formatDate(iso: string | null): string {
  if (iso === null) {
    return "—";
  }

  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

/**
 * La table des membres — EVT-046.
 *
 * ## Les filtres vivent dans l'URL
 *
 * `nuqs` plutôt qu'un `useState` : une vue filtrée est partageable et survit au
 * rechargement. Concrètement, « regarde les trois comptes suspendus » devient
 * un lien plutôt qu'une consigne à rejouer à la main.
 *
 * `clearOnDefault` fait disparaître les paramètres à leur valeur par défaut :
 * sans lui, l'adresse de l'écran vierge traînerait `?q=&status=all&page=1`.
 *
 * ## Le tri et la pagination sont côté client, délibérément
 *
 * `GET /organizations/{id}/members` renvoie la liste **entière** : le backend
 * n'expose ni curseur ni tri sur cette route. Paginer côté client est donc la
 * seule option honnête aujourd'hui, et elle tient tant qu'une organisation
 * compte des dizaines de membres — ce que `userLimit` borne. Le jour où la
 * route paginera, c'est ce composant qui change, pas l'écran.
 */
export function MembersTable({ organizationId }: { organizationId: string }) {
  const {
    data: members,
    isPending,
    isError,
    error,
  } = useMembers(organizationId);
  const { can } = usePermissions();
  const mutations = useMemberMutations(organizationId);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [filters, setFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(""),
      status: parseAsString.withDefault("all"),
      page: parseAsInteger.withDefault(1),
    },
    { clearOnDefault: true, history: "replace" },
  );

  const canManage = can(permissions.manageMemberRoles);

  const rows = useMemo(() => {
    const list = members ?? [];
    const needle = filters.q.trim().toLowerCase();

    return list.filter((member) => {
      const matchesStatus =
        filters.status === "all" || member.status === filters.status;
      const matchesSearch =
        needle === "" ||
        member.email.toLowerCase().includes(needle) ||
        fullName(member).toLowerCase().includes(needle);

      return matchesStatus && matchesSearch;
    });
  }, [members, filters.q, filters.status]);

  const columns = useMemo<ColumnDef<OrganizationMember>[]>(
    () => [
      {
        id: "member",
        header: "Membre",
        accessorFn: (member) => fullName(member) || member.email,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">
              {fullName(row.original) || "—"}
            </p>
            <p className="truncate text-muted-foreground">
              {row.original.email}
            </p>
          </div>
        ),
      },
      {
        id: "roles",
        header: "Rôles",
        cell: ({ row }) =>
          row.original.roleCodes.length === 0 ? (
            <span className="text-muted-foreground">Aucun</span>
          ) : (
            row.original.roleCodes.map(assignableRoleLabel).join(", ")
          ),
      },
      {
        id: "status",
        header: "Statut",
        accessorKey: "status",
        cell: ({ row }) => (
          <MembershipStatusBadge
            status={row.original.status as MembershipStatus}
          />
        ),
      },
      {
        id: "mfa",
        header: "MFA",
        cell: ({ row }) => (row.original.mfaEnabled ? "Activée" : "—"),
      },
      {
        id: "joinedAt",
        header: "Arrivé le",
        cell: ({ row }) => formatDate(row.original.joinedAt),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canManage ? (
            <MemberRowActions
              member={row.original}
              mutations={mutations}
              onError={setFeedback}
            />
          ) : null,
      },
    ],
    [canManage, mutations],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    /*
      La pagination est pilotée par l'URL et non par l'état interne de la table :
      deux sources de vérité pour le même numéro de page finiraient par
      diverger, et c'est l'URL qui doit gagner puisqu'elle est partageable.
    */
    state: { pagination: { pageIndex: filters.page - 1, pageSize: PAGE_SIZE } },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex: filters.page - 1, pageSize: PAGE_SIZE })
          : updater;

      void setFilters({ page: next.pageIndex + 1 });
    },
    manualPagination: false,
  });

  if (isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">Chargement des membres…</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof ApiError
          ? error.message
          : "Les membres n'ont pas pu être chargés."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={filters.q}
          aria-label="Rechercher un membre"
          placeholder="Nom ou adresse électronique"
          className="max-w-xs"
          onChange={(event) =>
            // La page repart à 1 : rester en page 3 d'une liste qui vient de
            // se réduire à quatre lignes afficherait un tableau vide.
            void setFilters({ q: event.target.value, page: 1 })
          }
        />

        <NativeSelect
          value={filters.status}
          aria-label="Filtrer par statut"
          onChange={(event) =>
            void setFilters({ status: event.target.value, page: 1 })
          }
        >
          {STATUS_FILTERS.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <p className="ml-auto text-sm text-muted-foreground">
          {rows.length} membre{rows.length > 1 ? "s" : ""}
        </p>
      </div>

      {feedback === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {feedback}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-10 text-center text-muted-foreground"
                >
                  Aucun membre ne correspond à cette recherche.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {filters.page} sur {table.getPageCount()}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Suivant
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
