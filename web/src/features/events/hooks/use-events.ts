"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateEvent,
  assignMember,
  cancelEvent,
  createEvent,
  createSession,
  getEvent,
  listAssignments,
  listEvents,
  listSessions,
  revokeAssignment,
  updateEvent,
} from "../api/events.api";

const keys = {
  list: ["events", "list"] as const,
  detail: (eventId: string) => ["events", "detail", eventId] as const,
  sessions: (eventId: string) => ["events", "sessions", eventId] as const,
  assignments: (eventId: string) => ["events", "assignments", eventId] as const,
};

export function useEvents() {
  return useQuery({ queryKey: keys.list, queryFn: listEvents });
}

export function useEvent(eventId: string | null) {
  return useQuery({
    queryKey: keys.detail(eventId ?? ""),
    queryFn: () => getEvent(eventId as string),
    enabled: eventId !== null,
  });
}

export function useSessions(eventId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.sessions(eventId ?? ""),
    queryFn: () => listSessions(eventId as string),
    enabled: eventId !== null && enabled,
  });
}

export function useAssignments(eventId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.assignments(eventId ?? ""),
    queryFn: () => listAssignments(eventId as string),
    enabled: eventId !== null && enabled,
  });
}

export function useEventMutations() {
  const queryClient = useQueryClient();
  const invalidate = (eventId?: string) => {
    void queryClient.invalidateQueries({ queryKey: keys.list });
    if (eventId)
      void queryClient.invalidateQueries({ queryKey: keys.detail(eventId) });
  };
  return {
    create: useMutation({
      mutationFn: createEvent,
      onSuccess: () => invalidate(),
    }),
    update: useMutation({
      mutationFn: updateEvent,
      onSuccess: (_, input) => invalidate(input.eventId),
    }),
    activate: useMutation({
      mutationFn: ({ eventId, etag }: { eventId: string; etag: string }) =>
        activateEvent(eventId, etag),
      onSuccess: (_, input) => invalidate(input.eventId),
    }),
    cancel: useMutation({
      mutationFn: ({
        eventId,
        etag,
        reason,
      }: {
        eventId: string;
        etag: string;
        reason: string;
      }) => cancelEvent(eventId, etag, reason),
      onSuccess: (_, input) => invalidate(input.eventId),
    }),
    session: useMutation({
      mutationFn: createSession,
      onSuccess: (_, input) =>
        void queryClient.invalidateQueries({
          queryKey: keys.sessions(input.eventId),
        }),
    }),
    assign: useMutation({
      mutationFn: assignMember,
      onSuccess: (_, input) =>
        void queryClient.invalidateQueries({
          queryKey: keys.assignments(input.eventId),
        }),
    }),
    revokeAssignment: useMutation({
      mutationFn: ({
        eventId,
        assignmentId,
      }: {
        eventId: string;
        assignmentId: string;
      }) => revokeAssignment(eventId, assignmentId),
      onSuccess: (_, input) =>
        void queryClient.invalidateQueries({
          queryKey: keys.assignments(input.eventId),
        }),
    }),
  };
}
