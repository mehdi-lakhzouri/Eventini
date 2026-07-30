import { apiClient } from "@/lib/api/api-client";
import type { CurrentUser, LoginInput } from "../types";

export function getCurrentUser() {
  return apiClient.get<CurrentUser>("/identity/authentication/me");
}

export function login(input: LoginInput) {
  return apiClient.post<CurrentUser>("/identity/authentication/login", input);
}

export function logout() {
  return apiClient.post<void>("/identity/authentication/logout");
}

export function refreshSession() {
  return apiClient.post<void>("/identity/authentication/refresh");
}
