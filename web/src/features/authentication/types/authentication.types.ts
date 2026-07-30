export type Role = "SUPER_ADMIN" | "CLIENT_ADMIN" | "SCANNER";

/**
 * The authenticated user as the browser is allowed to see them.
 *
 * `organizationId` is `null` for a platform session — a `SUPER_ADMIN` acting
 * outside any tenant — and for a user who belongs to several organizations and
 * has not activated one yet. In both cases the client must not guess: it calls
 * `POST /organizations/{organizationId}/activation` (ADR-0002).
 *
 * `permissions` is advisory. It exists so the UI can avoid rendering an action
 * that would be refused; it is never the authority. The backend re-resolves
 * permissions on every request (ADR-0004).
 */
export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  /**
   * Renamed from `tenantId` per ADR-0006: `organizationId` is the single
   * permitted term across the database, the API, the logs and this client.
   */
  organizationId: string | null;
  permissions: string[];
};

export type LoginInput = {
  email: string;
  password: string;
};
