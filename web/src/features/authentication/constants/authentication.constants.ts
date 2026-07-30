export const csrfHeaderName = "X-CSRF-Token";

export const authenticationQueryKeys = {
  currentUser: ["authentication", "current-user"] as const,
  sessions: ["authentication", "sessions"] as const,
};
