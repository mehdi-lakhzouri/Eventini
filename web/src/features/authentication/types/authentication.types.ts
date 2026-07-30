export type Role = "SUPER_ADMIN" | "CLIENT_ADMIN" | "SCANNER";

export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
  permissions: string[];
};

export type LoginInput = {
  email: string;
  password: string;
};
