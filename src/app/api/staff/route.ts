import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generatePasscode, normalizePhone } from "@/lib/staff-utils";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type StaffRole = "worker" | "manager";
type UserRole = "worker" | "manager" | "admin";

type CreateStaffBody = {
  business_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  role?: StaffRole | "admin";
  allowRoleUpgrade?: boolean;
};

type ErrorPayload = {
  error: string;
  status: number | null;
  code: string | null;
  details: string | null;
  hint: string | null;
  raw: string;
};

type ActorProfile = {
  id: string;
  role: UserRole;
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type BusinessRecord = {
  id: string;
  account_id: string;
};

type ExistingProfile = {
  id: string;
  role: UserRole;
  phone: string;
  company_id: string;
  account_id: string | null;
};

type ActorMembershipRow = {
  profile_id: string;
  role: StaffRole;
  is_active: boolean;
  updated_at: string | null;
  created_at: string | null;
};

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (key, input) => {
      const lowered = key.toLowerCase();
      if (
        lowered.includes("password") ||
        lowered.includes("passcode") ||
        lowered.includes("secret") ||
        lowered.includes("token") ||
        lowered.includes("apikey") ||
        lowered.includes("key")
      ) {
        return "[REDACTED]";
      }

      if (typeof input === "object" && input !== null) {
        if (seen.has(input)) return "[Circular]";
        seen.add(input);
      }

      return input;
    },
    2
  );
}

function toErrorPayload(input: unknown): ErrorPayload {
  const errorObj =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  return {
    error:
      (typeof errorObj.message === "string" && errorObj.message) ||
      "Failed to create or attach staff account.",
    status:
      typeof errorObj.status === "number"
        ? errorObj.status
        : typeof errorObj.statusCode === "number"
          ? errorObj.statusCode
          : null,
    code:
      (typeof errorObj.code === "string" && errorObj.code) ||
      (typeof errorObj.error_code === "string" && errorObj.error_code) ||
      (typeof errorObj.name === "string" && errorObj.name) ||
      null,
    details:
      (typeof errorObj.details === "string" && errorObj.details) ||
      (typeof errorObj.error_description === "string" &&
        errorObj.error_description) ||
      null,
    hint:
      (typeof errorObj.hint === "string" && errorObj.hint) ||
      (typeof errorObj.help === "string" && errorObj.help) ||
      null,
    raw: safeStringify(input),
  };
}

function authLogGuidance(): string {
  return "Supabase Dashboard -> Logs: check Auth and Postgres around this request timestamp.";
}

function membershipRoleFor(role: UserRole): StaffRole {
  if (role === "worker") return "worker";
  if (role === "manager" || role === "admin") return "manager";
  const _never: never = role;
  return _never;
}

function chooseActorMembership(rows: ActorMembershipRow[]): ActorMembershipRow | null {
  const activeRows = rows.filter((row) => row.is_active);
  if (activeRows.length === 0) return null;

  const sorted = [...activeRows].sort((a, b) => {
    const roleRank = (value: StaffRole) => (value === "manager" ? 2 : 1);
    const byRole = roleRank(b.role) - roleRank(a.role);
    if (byRole !== 0) return byRole;

    const aUpdated = Date.parse(a.updated_at ?? a.created_at ?? "");
    const bUpdated = Date.parse(b.updated_at ?? b.created_at ?? "");
    const safeA = Number.isFinite(aUpdated) ? aUpdated : 0;
    const safeB = Number.isFinite(bUpdated) ? bUpdated : 0;
    return safeB - safeA;
  });

  return sorted[0] ?? null;
}

async function getManagerContext() {
  const sessionClient = await createClient();

  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: actorProfile, error: profileError } = await sessionClient
    .from("profiles")
    .select("id, role, company_id, account_id, is_active")
    .eq("id", user.id)
    .single();

  if (profileError || !actorProfile) {
    return {
      error: jsonNoStore({ error: "Unable to load your profile." }, 403),
    };
  }

  if (!actorProfile.is_active) {
    return {
      error: jsonNoStore({ error: "Your account is inactive." }, 403),
    };
  }

  if (actorProfile.role !== "manager" && actorProfile.role !== "admin") {
    return {
      error: jsonNoStore(
        { error: "Manager or admin access required." },
        403
      ),
    };
  }

  return {
    sessionClient,
    actorProfile: actorProfile as ActorProfile,
  };
}

async function requireBusinessAccess(
  admin: ReturnType<typeof createAdminClient>,
  sessionClient: Awaited<ReturnType<typeof createClient>>,
  actorProfile: ActorProfile,
  businessId: string
): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; business: BusinessRecord }
> {
  const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("id, account_id")
    .eq("id", businessId)
    .single();

  if (businessError || !business) {
    return {
      ok: false,
      response: jsonNoStore({ error: "Business not found." }, 404),
    };
  }

  if (business.account_id !== actorAccountId) {
    return {
      ok: false,
      response: jsonNoStore(
        { error: "You do not have access to that business." },
        403
      ),
    };
  }

  if (actorProfile.role !== "admin") {
    const { data: actorMembershipRows, error: actorMembershipError } = await sessionClient
      .from("business_memberships")
      .select("profile_id, role, is_active, updated_at, created_at")
      .eq("business_id", businessId)
      .eq("profile_id", actorProfile.id);

    if (actorMembershipError) {
      return {
        ok: false,
        response: jsonNoStore(
          { error: "Unable to load your membership for this business." },
          400
        ),
      };
    }

    const typedRows = (actorMembershipRows ?? []) as ActorMembershipRow[];
    const chosenMembership = chooseActorMembership(typedRows);

    if (!chosenMembership) {
      return {
        ok: false,
        response: jsonNoStore(
          { error: "You are not an active member of this business." },
          403
        ),
      };
    }

    if (actorProfile.role === "manager" && chosenMembership.role !== "manager") {
      return {
        ok: false,
        response: jsonNoStore(
          { error: "Manager membership is required for this business." },
          403
        ),
      };
    }
  }

  return { ok: true, business: business as BusinessRecord };
}

async function upsertBusinessMembership(
  admin: ReturnType<typeof createAdminClient>,
  businessId: string,
  profileId: string,
  role: StaffRole
): Promise<{ error: string | null }> {
  const { error } = await admin.from("business_memberships").upsert(
    {
      business_id: businessId,
      profile_id: profileId,
      role,
      is_active: true,
    },
    { onConflict: "business_id,profile_id" }
  );

  return { error: error?.message ?? null };
}

export async function POST(request: Request) {
  try {
    const context = await getManagerContext();
    if ("error" in context) return context.error;

    const { sessionClient, actorProfile } = context;
    const admin = createAdminClient();

    const body = (await request.json().catch(() => ({}))) as CreateStaffBody;

    const businessId = (body.business_id ?? "").trim();
    const firstName = (body.first_name ?? "").trim();
    const lastName = (body.last_name ?? "").trim();
    const phone = normalizePhone(body.phone ?? "");
    const requestedRole = body.role;
    const allowRoleUpgrade = body.allowRoleUpgrade === true;

    if (!businessId || !firstName || !lastName || !phone || !requestedRole) {
      return jsonNoStore(
        {
          error:
            "business_id, first_name, last_name, phone, and role are required.",
        },
        400
      );
    }

    if (requestedRole !== "worker" && requestedRole !== "manager") {
      return jsonNoStore(
        {
          error: "Role must be either 'worker' or 'manager'.",
          code: "INVALID_ROLE",
        },
        400
      );
    }

    const access = await requireBusinessAccess(
      admin,
      sessionClient,
      actorProfile,
      businessId
    );
    if (!access.ok) return access.response;

    const { business } = access;

    const { data: existingByPhone, error: existingError } = await admin
      .from("profiles")
      .select("id, role, phone, company_id, account_id")
      .eq("phone", phone)
      .maybeSingle();

    if (existingError) {
      return jsonNoStore(
        {
          error: "Failed to look up profile by phone.",
          code: existingError.code ?? null,
          details: existingError.details ?? null,
          hint: existingError.hint ?? null,
        },
        400
      );
    }

    if (existingByPhone) {
      const existing = existingByPhone as ExistingProfile;
      let finalRole: UserRole = existing.role;
      const existingAccountId = existing.account_id ?? existing.company_id;

      if (existingAccountId !== business.account_id) {
        return jsonNoStore(
          {
            error:
              "This phone already belongs to a profile under a different account and cannot be attached here.",
            code: "PHONE_ACCOUNT_MISMATCH",
          },
          409
        );
      }

      if (existing.role === "admin") {
        return jsonNoStore(
          {
            error: "Admin users cannot be managed through this endpoint.",
            code: "ADMIN_ROLE_FORBIDDEN",
          },
          403
        );
      }

      if (requestedRole !== existing.role) {
        if (requestedRole === "manager" && existing.role === "worker") {
          if (!allowRoleUpgrade) {
            return jsonNoStore(
              {
                error:
                  "This phone already belongs to a worker. Re-submit with allowRoleUpgrade=true to promote to manager.",
                code: "ROLE_UPGRADE_CONFIRM_REQUIRED",
              },
              409
            );
          }

          const { error: upgradeError } = await admin
            .from("profiles")
            .update({ role: "manager" })
            .eq("id", existing.id);

          if (upgradeError) {
            return jsonNoStore(
              {
                error: "Unable to upgrade existing profile role.",
                code: upgradeError.code ?? null,
                details: upgradeError.details ?? null,
                hint: upgradeError.hint ?? null,
              },
              400
            );
          }

          finalRole = "manager";
        } else if (requestedRole === "worker" && existing.role === "manager") {
          return jsonNoStore(
            {
              error:
                "This phone already belongs to a manager. Downgrade is not allowed from this endpoint.",
              code: "ROLE_DOWNGRADE_FORBIDDEN",
            },
            409
          );
        }
      }

      const membership = await upsertBusinessMembership(
        admin,
        businessId,
        existing.id,
        membershipRoleFor(finalRole)
      );

      if (membership.error) {
        return jsonNoStore(
          {
            error: "Unable to attach existing profile to business.",
            details: membership.error,
          },
          400
        );
      }

      return jsonNoStore(
        {
          created: false,
          attached: true,
          profile_id: existing.id,
          role: finalRole,
        },
        200
      );
    }

    const passcode = generatePasscode();
    const email = `staff-${phone.replace(/\D/g, "")}-${crypto
      .randomUUID()
      .split("-")[0]}@internal.crewclock.local`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: passcode,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone,
        role: requestedRole,
        company_id: actorProfile.company_id,
        account_id: business.account_id,
      },
    });

    if (createError || !created.user) {
      const errorPayload = toErrorPayload(
        createError ?? new Error("Database error creating new user")
      );

      return jsonNoStore(
        {
          ...errorPayload,
          next_steps: authLogGuidance(),
        },
        errorPayload.status ?? 400
      );
    }

    const createdUserId = created.user.id;

    const { error: profileUpsertError } = await admin.from("profiles").upsert(
      {
        id: createdUserId,
        company_id: actorProfile.company_id,
        account_id: business.account_id,
        first_name: firstName,
        last_name: lastName,
        phone,
        role: requestedRole,
        is_active: true,
      },
      { onConflict: "id" }
    );

    if (profileUpsertError) {
      await admin.auth.admin.deleteUser(createdUserId);
      return jsonNoStore(
        {
          error: "Unable to create profile for new staff user.",
          code: profileUpsertError.code ?? null,
          details: profileUpsertError.details ?? null,
          hint: profileUpsertError.hint ?? null,
        },
        400
      );
    }

    const { error: passcodeError } = await sessionClient.rpc("set_staff_passcode", {
      p_user_id: createdUserId,
      p_phone: phone,
      p_passcode: passcode,
    });

    if (passcodeError) {
      await admin.auth.admin.deleteUser(createdUserId);
      return jsonNoStore(
        buildRpcErrorPayload(
          "set_staff_passcode",
          ["p_user_id", "p_phone", "p_passcode"],
          passcodeError
        ),
        400
      );
    }

    const membership = await upsertBusinessMembership(
      admin,
      businessId,
      createdUserId,
      membershipRoleFor(requestedRole)
    );

    if (membership.error) {
      await admin.auth.admin.deleteUser(createdUserId);
      return jsonNoStore(
        {
          error: "Unable to attach new profile to business.",
          details: membership.error,
        },
        400
      );
    }

    return jsonNoStore(
      {
        created: true,
        passcode,
        profile_id: createdUserId,
        role: requestedRole,
      },
      200
    );
  } catch (error: unknown) {
    const errorPayload = toErrorPayload(error);

    return jsonNoStore(
      {
        ...errorPayload,
        error: "Unexpected staff creation failure.",
        next_steps: authLogGuidance(),
      },
      500
    );
  }
}
