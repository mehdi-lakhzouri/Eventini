import { AuthGuard } from "@/features/authentication";

export default function SuperAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AuthGuard requiredRole="SUPER_ADMIN">{children}</AuthGuard>;
}
