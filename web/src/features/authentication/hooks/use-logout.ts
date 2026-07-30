"use client";

import { useMutation } from "@tanstack/react-query";
import { logout } from "../api/authentication.api";

export function useLogout() {
  return useMutation({
    mutationFn: logout,
  });
}
