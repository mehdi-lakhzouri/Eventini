import { apiClient } from "@/lib/api/api-client";
import type {
  EventAssignment,
  EventInput,
  EventProfile,
  EventSession,
  VersionedEvent,
} from "../types/event.types";

const eventPath = (eventId: string) => `/events/${encodeURIComponent(eventId)}`;

export function listEvents() {
  return apiClient.get<EventProfile[]>("/events");
}

export async function getEvent(eventId: string): Promise<VersionedEvent> {
  const response = await apiClient.getEnvelope<EventProfile>(
    eventPath(eventId),
  );
  return { event: response.data as EventProfile, etag: response.etag };
}

export function createEvent(input: EventInput) {
  return apiClient.post<EventProfile>("/events", input);
}

export function updateEvent(
  input: EventInput & { eventId: string; etag: string },
) {
  const { eventId, etag, ...body } = input;
  return apiClient.patchEnvelope<EventProfile>(eventPath(eventId), body, {
    ifMatch: etag,
  });
}

export function activateEvent(eventId: string, etag: string) {
  return apiClient.post<EventProfile>(
    `${eventPath(eventId)}/activation`,
    undefined,
    { ifMatch: etag },
  );
}

export function cancelEvent(eventId: string, etag: string, reason: string) {
  return apiClient.post<EventProfile>(
    `${eventPath(eventId)}/cancellation`,
    { reason },
    { ifMatch: etag },
  );
}

export function listSessions(eventId: string) {
  return apiClient.get<EventSession[]>(`${eventPath(eventId)}/sessions`);
}

export function createSession(input: {
  eventId: string;
  name: string;
  sessionType: EventSession["sessionType"];
  startsAt: string;
  endsAt: string;
  locationName?: string | null;
}) {
  const { eventId, ...body } = input;
  return apiClient.post<EventSession>(`${eventPath(eventId)}/sessions`, body);
}

export function listAssignments(eventId: string) {
  return apiClient.get<EventAssignment[]>(`${eventPath(eventId)}/assignments`);
}

export function assignMember(input: {
  eventId: string;
  membershipId: string;
  assignmentType: EventAssignment["assignmentType"];
}) {
  const { eventId, ...body } = input;
  return apiClient.post<EventAssignment>(
    `${eventPath(eventId)}/assignments`,
    body,
  );
}

export function revokeAssignment(eventId: string, assignmentId: string) {
  return apiClient.delete<EventAssignment>(
    `${eventPath(eventId)}/assignments/${encodeURIComponent(assignmentId)}`,
  );
}
