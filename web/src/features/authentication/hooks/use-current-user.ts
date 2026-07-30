"use client";

import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "../api/authentication.api";
import { authenticationQueryKeys } from "../constants/authentication.constants";

export function useCurrentUser() {
  return useQuery({
    queryKey: authenticationQueryKeys.currentUser,
    queryFn: getCurrentUser,
  });
}
