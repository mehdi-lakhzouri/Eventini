import { apiClient } from "@/lib/api/api-client";
import type { ForgotPasswordInput, ResetPasswordInput } from "../types";

export function requestPasswordReset(input: ForgotPasswordInput) {
  return apiClient.post<void>("/identity/passwords/reset-request", input);
}

export function resetPassword(input: ResetPasswordInput) {
  return apiClient.post<void>("/identity/passwords/reset", input);
}
