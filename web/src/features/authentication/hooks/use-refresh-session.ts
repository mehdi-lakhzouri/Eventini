"use client";

import { useMutation } from "@tanstack/react-query";
import { refreshSession } from "../api/authentication.api";

export function useRefreshSession() {
  return useMutation({
    mutationFn: refreshSession,
  });
}
