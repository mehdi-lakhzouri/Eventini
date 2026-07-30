import { apiClient } from "@/lib/api/api-client";
import type { MfaVerificationInput } from "../types";

export function verifyMfa(input: MfaVerificationInput) {
  return apiClient.post<void>("/identity/mfa/verify", input);
}
