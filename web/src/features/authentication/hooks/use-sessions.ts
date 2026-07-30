"use client";

import { useQuery } from "@tanstack/react-query";
import { listSessions } from "../api/sessions.api";
import { authenticationQueryKeys } from "../constants/authentication.constants";

export function useSessions() {
  return useQuery({
    queryKey: authenticationQueryKeys.sessions,
    queryFn: listSessions,
  });
}
