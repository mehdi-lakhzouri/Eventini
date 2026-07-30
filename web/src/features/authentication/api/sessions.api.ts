import { apiClient } from "@/lib/api/api-client";
import type { UserSession } from "../types";

export function listSessions() {
  return apiClient.get<UserSession[]>("/identity/sessions");
}

export function revokeSession(sessionId: string) {
  return apiClient.delete<void>(`/identity/sessions/${sessionId}`);
}

export function revokeAllSessions() {
  return apiClient.post<void>("/identity/sessions/revoke-all");
}
