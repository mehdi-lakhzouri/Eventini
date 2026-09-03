export const EVENT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "EXPIRED",
  "CANCELLED",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type EventProfile = {
  eventId: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  status: EventStatus;
  eventCode: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  checkInOpensAt: string | null;
  checkInClosesAt: string | null;
  capacity: number | null;
  locationName: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type VersionedEvent = { event: EventProfile; etag: string | null };

export type EventSession = {
  sessionId: string;
  eventId: string;
  name: string;
  sessionType: "DAY" | "PANEL" | "WORKSHOP" | "ZONE" | "SLOT";
  status: "SCHEDULED" | "OPEN" | "CLOSED";
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  locationName: string | null;
  requiresSeparateCheckIn: boolean;
};

export type EventAssignment = {
  assignmentId: string;
  membershipId: string;
  assignmentType:
    "EVENT_ADMIN" | "SCANNER" | "REPORT_VIEWER" | "SESSION_MANAGER";
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  validFrom: string | null;
  validUntil: string | null;
};

export type EventInput = {
  name: string;
  slug: string;
  description?: string | null;
  timezone: string;
  startsAt: string;
  endsAt: string;
  capacity?: number | null;
  locationName?: string | null;
};
