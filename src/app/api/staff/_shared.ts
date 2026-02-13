import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type UserRole = "worker" | "manager" | "admin";

type ActorProfile = {
  id: string;
  role: UserRole;
  company_id: string;
};

type TargetProfile = {
  id: string;
  role: UserRole;
  company_id: string;
  phone: string;
};

type OwnerAdminContext = {
  sessionClient: Awaited<ReturnType<typeof createClient>>;
  actor: ActorProfile;
  target: TargetProfile;
  isOwner: boolean;
  isAdmin: boolean;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERNAL_EMAIL_DOMAIN = "@internal.crewclock.local";

export function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export function serializeError(error: {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}) {
  return {
    error: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
    code: error.code ?? null,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isInternalEmail(email: string): boolean {
  return normalizeEmail(email).endsWith(INTERNAL_EMAIL_DOMAIN);
}

export function internalEmailFor(phone: string, userId?: string): string {
  const digits = phone.replace(/\D/g, "");
  const suffix =
    userId?.replace(/-/g, "").slice(0, 8) ??
    crypto.randomUUID().split("-")[0];
  return `staff-${digits}-${suffix}@internal.crewclock.local`;
}

export async function requireOwnerOrAdminForTarget(
  targetUserId: string
): Promise<{ error: NextResponse } | OwnerAdminContext> {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return { error: jsonNoStore({ error: "Unauthorized" }, 401) };
  }

  const { data: actor } = await sessionClient
    .from("profiles")
    .select("id, role, company_id")
    .eq("id", user.id)
    .single();

  if (!actor) {
    return { error: jsonNoStore({ error: "Unable to load your profile." }, 403) };
  }

  const { data: company } = await sessionClient
    .from("companies")
    .select("owner_user_id")
    .eq("id", actor.company_id)
    .single();

  const isOwner = company?.owner_user_id === actor.id;
  const isAdmin = actor.role === "admin";

  if (!isOwner && !isAdmin) {
    return { error: jsonNoStore({ error: "Owner or admin access required." }, 403) };
  }

  const { data: target } = await sessionClient
    .from("profiles")
    .select("id, role, company_id, phone")
    .eq("id", targetUserId)
    .single();

  if (!target || target.company_id !== actor.company_id) {
    return {
      error: jsonNoStore({ error: "Staff member not found in your company." }, 404),
    };
  }

  return {
    sessionClient,
    actor: actor as ActorProfile,
    target: target as TargetProfile,
    isOwner,
    isAdmin,
  };
}
