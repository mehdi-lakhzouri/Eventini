"use client";

import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { permissions } from "@/config/permissions";
import { usePermissions } from "@/features/authentication";
import { OrganizationScope } from "@/features/organizations";
import { ApiError } from "@/lib/api/api-error";
import {
  useAssignments,
  useEvent,
  useEventMutations,
  useEvents,
  useSessions,
} from "../hooks/use-events";
import type { EventInput, EventSession } from "../types/event.types";

const PAGE_SIZE = 10;
const timezones = [
  "Africa/Lagos",
  "Africa/Abidjan",
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "UTC",
];
const emptyInput: EventInput = {
  name: "",
  slug: "",
  description: "",
  timezone: "Africa/Lagos",
  startsAt: "",
  endsAt: "",
  capacity: null,
  locationName: "",
};

function inTimezone(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}

function toIso(value: string): string {
  return value === "" ? "" : new Date(value).toISOString();
}

function errorMessage(error: unknown, conflict: string): string {
  return error instanceof ApiError && error.status === 409
    ? conflict
    : error instanceof Error
      ? error.message
      : conflict;
}

function EventForm({
  onSubmit,
  pending,
  initial = emptyInput,
  submitLabel,
}: {
  onSubmit: (input: EventInput) => void;
  pending: boolean;
  initial?: EventInput;
  submitLabel: string;
}) {
  const t = useTranslations("events");
  const [input, setInput] = useState<EventInput>(initial);
  const change = (field: keyof EventInput, value: string | number | null) =>
    setInput((current) => ({ ...current, [field]: value }));
  return (
    <form
      className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          ...input,
          startsAt: toIso(input.startsAt),
          endsAt: toIso(input.endsAt),
          description: input.description || null,
          locationName: input.locationName || null,
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="event-name">{t("name")}</Label>
        <Input
          id="event-name"
          required
          value={input.name}
          onChange={(event) => change("name", event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-slug">{t("slug")}</Label>
        <Input
          id="event-slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={input.slug}
          onChange={(event) => change("slug", event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-timezone">{t("timezone")}</Label>
        <NativeSelect
          id="event-timezone"
          value={input.timezone}
          onChange={(event) => change("timezone", event.target.value)}
        >
          {timezones.map((timezone) => (
            <NativeSelectOption key={timezone} value={timezone}>
              {timezone}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-capacity">{t("capacity")}</Label>
        <Input
          id="event-capacity"
          type="number"
          min="1"
          value={input.capacity ?? ""}
          onChange={(event) =>
            change(
              "capacity",
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-start">{t("startsAt")}</Label>
        <Input
          id="event-start"
          required
          type="datetime-local"
          value={input.startsAt}
          onChange={(event) => change("startsAt", event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-end">{t("endsAt")}</Label>
        <Input
          id="event-end"
          required
          type="datetime-local"
          value={input.endsAt}
          onChange={(event) => change("endsAt", event.target.value)}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="event-location">{t("location")}</Label>
        <Input
          id="event-location"
          value={input.locationName ?? ""}
          onChange={(event) => change("locationName", event.target.value)}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="event-description">{t("description")}</Label>
        <Textarea
          id="event-description"
          value={input.description ?? ""}
          onChange={(event) => change("description", event.target.value)}
        />
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function EventWorkspace({ eventId }: { eventId: string }) {
  const t = useTranslations("events");
  const { can } = usePermissions();
  const eventQuery = useEvent(eventId);
  const canSessions = can(permissions.manageEventSessions);
  const canAssignments = can(permissions.manageMemberRoles);
  const sessions = useSessions(eventId, canSessions);
  const assignments = useAssignments(eventId, canAssignments);
  const mutations = useEventMutations();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  if (eventQuery.isPending) return <Skeleton className="h-96 w-full" />;
  if (eventQuery.isError || !eventQuery.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("loadFailed")}
      </p>
    );
  const { event, etag } = eventQuery.data;
  const initial: EventInput = {
    name: event.name,
    slug: event.slug,
    description: event.description,
    timezone: event.timezone,
    startsAt: event.startsAt.slice(0, 16),
    endsAt: event.endsAt.slice(0, 16),
    capacity: event.capacity,
    locationName: event.locationName,
  };
  const save = (input: EventInput) => {
    if (etag === null) {
      setFeedback(t("modifiedMeanwhile"));
      return;
    }
    mutations.update.mutate(
      { eventId, etag, ...input },
      {
        onError: (error) =>
          setFeedback(errorMessage(error, t("modifiedMeanwhile"))),
        onSuccess: () => setFeedback(t("saved")),
      },
    );
  };
  const transition = (kind: "activate" | "cancel") => {
    if (etag === null) {
      setFeedback(t("modifiedMeanwhile"));
      return;
    }
    const confirmed = window.confirm(
      kind === "activate" ? t("confirmActivate") : t("confirmCancel"),
    );
    if (!confirmed) return;
    if (kind === "activate")
      mutations.activate.mutate(
        { eventId, etag },
        {
          onError: (error) =>
            setFeedback(errorMessage(error, t("modifiedMeanwhile"))),
        },
      );
    else
      mutations.cancel.mutate(
        { eventId, etag, reason: cancelReason.trim() },
        {
          onError: (error) =>
            setFeedback(errorMessage(error, t("modifiedMeanwhile"))),
        },
      );
  };
  return (
    <div className="space-y-8 rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{t("eventCode")}</p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 font-semibold">
              {event.eventCode}
            </code>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void navigator.clipboard?.writeText(event.eventCode)
              }
            >
              {t("copy")}
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          {event.status === "DRAFT" && can(permissions.activateEvents) ? (
            <Button
              onClick={() => transition("activate")}
              disabled={mutations.activate.isPending}
            >
              {t("activate")}
            </Button>
          ) : null}
          {(event.status === "DRAFT" || event.status === "ACTIVE") &&
          can(permissions.cancelEvents) ? (
            <Button
              variant="destructive"
              onClick={() => transition("cancel")}
              disabled={
                mutations.cancel.isPending || cancelReason.trim() === ""
              }
            >
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("status")}: {event.status} · {t("timezone")}: {event.timezone}
      </p>
      {event.status === "DRAFT" || event.status === "ACTIVE" ? (
        <div className="flex max-w-xl items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="cancel-reason">{t("cancelReason")}</Label>
            <Input
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
        </div>
      ) : null}
      {feedback ? (
        <p role="alert" className="text-sm text-destructive">
          {feedback}
        </p>
      ) : null}
      {can(permissions.updateEvents) ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("editEvent")}</h2>
          <EventForm
            key={event.eventId}
            initial={initial}
            pending={mutations.update.isPending}
            onSubmit={save}
            submitLabel={t("save")}
          />
        </section>
      ) : null}
      {canSessions ? (
        <SessionEditor
          eventId={eventId}
          timezone={event.timezone}
          sessions={sessions.data ?? []}
          pending={sessions.isPending}
          onCreate={(input) =>
            mutations.session.mutate(input, {
              onError: (error) =>
                setFeedback(errorMessage(error, t("modifiedMeanwhile"))),
            })
          }
        />
      ) : null}
      {canAssignments ? (
        <AssignmentsPanel
          eventId={eventId}
          assignments={assignments.data ?? []}
          pending={assignments.isPending}
          onAssign={(input) =>
            mutations.assign.mutate(input, {
              onError: (error) =>
                setFeedback(errorMessage(error, t("modifiedMeanwhile"))),
            })
          }
          onRevoke={(assignmentId) =>
            mutations.revokeAssignment.mutate({ eventId, assignmentId })
          }
        />
      ) : null}
    </div>
  );
}

function SessionEditor({
  eventId,
  timezone,
  sessions,
  pending,
  onCreate,
}: {
  eventId: string;
  timezone: string;
  sessions: EventSession[];
  pending: boolean;
  onCreate: (input: {
    eventId: string;
    name: string;
    sessionType: EventSession["sessionType"];
    startsAt: string;
    endsAt: string;
    locationName?: string | null;
  }) => void;
}) {
  const t = useTranslations("events");
  const [name, setName] = useState("");
  const [type, setType] = useState<EventSession["sessionType"]>("DAY");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [locationName, setLocationName] = useState("");
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("sessions")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("timezone")}: {timezone}
      </p>
      {pending ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <li key={session.sessionId} className="rounded-lg bg-muted p-3">
              <strong>{session.name}</strong> · {session.sessionType} ·{" "}
              {inTimezone(session.startsAt, timezone)} —{" "}
              {inTimezone(session.endsAt, timezone)}{" "}
              <span className="text-muted-foreground">({timezone})</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            eventId,
            name,
            sessionType: type,
            startsAt: toIso(startsAt),
            endsAt: toIso(endsAt),
            locationName: locationName || null,
          });
          setName("");
          setStartsAt("");
          setEndsAt("");
        }}
      >
        <Input
          required
          value={name}
          placeholder={t("sessionName")}
          onChange={(e) => setName(e.target.value)}
        />
        <NativeSelect
          value={type}
          onChange={(e) =>
            setType(e.target.value as EventSession["sessionType"])
          }
        >
          {["DAY", "PANEL", "WORKSHOP", "ZONE", "SLOT"].map((value) => (
            <NativeSelectOption key={value} value={value}>
              {value}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          required
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
        <Input
          required
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
        <Input
          value={locationName}
          placeholder={t("location")}
          onChange={(e) => setLocationName(e.target.value)}
        />
        <Button type="submit">{t("addSession")}</Button>
      </form>
    </section>
  );
}

function AssignmentsPanel({
  eventId,
  assignments,
  pending,
  onAssign,
  onRevoke,
}: {
  eventId: string;
  assignments: {
    assignmentId: string;
    membershipId: string;
    assignmentType: string;
    status: string;
  }[];
  pending: boolean;
  onAssign: (input: {
    eventId: string;
    membershipId: string;
    assignmentType:
      "EVENT_ADMIN" | "SCANNER" | "REPORT_VIEWER" | "SESSION_MANAGER";
  }) => void;
  onRevoke: (assignmentId: string) => void;
}) {
  const t = useTranslations("events");
  const [membershipId, setMembershipId] = useState("");
  const [assignmentType, setAssignmentType] = useState<
    "EVENT_ADMIN" | "SCANNER" | "REPORT_VIEWER" | "SESSION_MANAGER"
  >("SCANNER");
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("assignments")}</h2>
      {pending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ul className="space-y-2">
          {assignments.map((assignment) => (
            <li
              key={assignment.assignmentId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3"
            >
              <span>
                <code>{assignment.membershipId}</code> ·{" "}
                {assignment.assignmentType} · {assignment.status}
              </span>
              {assignment.status === "ACTIVE" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRevoke(assignment.assignmentId)}
                >
                  {t("revoke")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onAssign({ eventId, membershipId, assignmentType });
          setMembershipId("");
        }}
      >
        <Input
          required
          value={membershipId}
          placeholder={t("membershipId")}
          className="max-w-sm"
          onChange={(e) => setMembershipId(e.target.value)}
        />
        <NativeSelect
          value={assignmentType}
          onChange={(e) =>
            setAssignmentType(e.target.value as typeof assignmentType)
          }
        >
          {["EVENT_ADMIN", "SCANNER", "REPORT_VIEWER", "SESSION_MANAGER"].map(
            (value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
        <Button type="submit">{t("assign")}</Button>
      </form>
    </section>
  );
}

function EventsContent() {
  const t = useTranslations("events");
  const { can, isPending: permissionsPending } = usePermissions();
  const { data, isPending, isError } = useEvents();
  const mutations = useEventMutations();
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [filters, setFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(""),
      status: parseAsString.withDefault("all"),
      page: parseAsInteger.withDefault(1),
    },
    { clearOnDefault: true, history: "replace" },
  );
  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (event) =>
          (filters.status === "all" || event.status === filters.status) &&
          (filters.q.trim() === "" ||
            `${event.name} ${event.eventCode} ${event.slug}`
              .toLowerCase()
              .includes(filters.q.trim().toLowerCase())),
      ),
    [data, filters.q, filters.status],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  if (permissionsPending || isPending)
    return <Skeleton className="h-96 w-full" />;
  if (!can(permissions.readEvents) && !can(permissions.createEvents))
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        {t("forbidden")}
      </p>
    );
  return (
    <div className="space-y-8">
      {can(permissions.createEvents) ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("create")}</h2>
          <EventForm
            pending={mutations.create.isPending}
            submitLabel={t("create")}
            onSubmit={(input) =>
              mutations.create.mutate(input, {
                onSuccess: (event) => {
                  setSelected(event.eventId);
                  setFeedback(null);
                },
                onError: (error) =>
                  setFeedback(errorMessage(error, t("modifiedMeanwhile"))),
              })
            }
          />
        </section>
      ) : null}
      {feedback ? (
        <p role="alert" className="text-sm text-destructive">
          {feedback}
        </p>
      ) : null}
      {can(permissions.readEvents) ? (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Input
              type="search"
              className="max-w-xs"
              value={filters.q}
              placeholder={t("search")}
              onChange={(event) =>
                void setFilters({ q: event.target.value, page: 1 })
              }
            />
            <NativeSelect
              value={filters.status}
              onChange={(event) =>
                void setFilters({ status: event.target.value, page: 1 })
              }
            >
              {["all", "DRAFT", "ACTIVE", "EXPIRED", "CANCELLED"].map(
                (status) => (
                  <NativeSelectOption key={status} value={status}>
                    {status === "all" ? t("allStatuses") : status}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
          </div>
          {isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("loadFailed")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-3">{t("name")}</th>
                    <th className="p-3">{t("eventCode")}</th>
                    <th className="p-3">{t("schedule")}</th>
                    <th className="p-3">{t("status")}</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td className="p-6 text-muted-foreground" colSpan={5}>
                        {t("empty")}
                      </td>
                    </tr>
                  ) : (
                    visible.map((event) => (
                      <tr key={event.eventId} className="border-b">
                        <td className="p-3 font-medium">
                          {event.name}
                          <div className="text-muted-foreground">
                            {event.slug}
                          </div>
                        </td>
                        <td className="p-3">
                          <code>{event.eventCode}</code>
                        </td>
                        <td className="p-3">
                          {inTimezone(event.startsAt, event.timezone)}
                          <div className="text-muted-foreground">
                            {event.timezone}
                          </div>
                        </td>
                        <td className="p-3">{event.status}</td>
                        <td className="p-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelected(event.eventId)}
                          >
                            {t("manage")}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {pageCount > 1 ? (
            <div className="flex justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => void setFilters({ page: page - 1 })}
              >
                {t("previous")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {page}/{pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => void setFilters({ page: page + 1 })}
              >
                {t("next")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {selected ? <EventWorkspace eventId={selected} /> : null}
    </div>
  );
}

export function EventsPanel() {
  return <OrganizationScope>{() => <EventsContent />}</OrganizationScope>;
}
