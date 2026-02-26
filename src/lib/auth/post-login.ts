export type AuthRole = "admin" | "manager" | "worker" | null | undefined;

export function getPostLoginPath(role: AuthRole): "/dashboard" | "/clock" {
  return role === "admin" || role === "manager" ? "/dashboard" : "/clock";
}

export function logPostLoginRedirect(
  context: string,
  role: AuthRole,
  destination: "/dashboard" | "/clock"
) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[auth-redirect] ${context}: role=${role ?? "unknown"} -> ${destination}`);
}

