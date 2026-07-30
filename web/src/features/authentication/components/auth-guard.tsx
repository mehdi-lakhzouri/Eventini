"use client";

import type { ReactNode } from "react";
import type { Role } from "../types";

type AuthGuardProps = {
  children: ReactNode;
  requiredRole?: Role;
};

export function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}
