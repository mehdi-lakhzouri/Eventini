"use client";

import { useMutation } from "@tanstack/react-query";
import { login } from "../api/authentication.api";

export function useLogin() {
  return useMutation({
    mutationFn: login,
  });
}
