import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type CreateBusinessBody = {
  name?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
};

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type MembershipRole = "manager" | "worker";

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function membershipRoleForActor(role: ActorProfile["role"]): MembershipRole {
  return role === "worker" ? "worker" : "manager";
}

async function requireAdminActor() {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return { error: jsonNoStore({ error: "Unauthorized" }, 401) };
  }

  const { data: actor, error: actorError } = await sessionClient
    .from("profiles")
    .select("id, role, company_id, account_id, is_active")
    .eq("id", user.id)
    .single();

  if (actorError || !actor) {
    return { error: jsonNoStore({ error: "Unable to load your profile." }, 403) };
  }

  const actorProfile = actor as ActorProfile;

  if (!actorProfile.is_active) {
    return { error: jsonNoStore({ error: "Your account is inactive." }, 403) };
  }

  if (actorProfile.role !== "admin") {
    return { error: jsonNoStore({ error: "Admin access required." }, 403) };
  }

  return { actorProfile };
}

export async function GET() {
  try {
    const context = await requireAdminActor();
    if ("error" in context) return context.error;

    const accountId = context.actorProfile.account_id ?? context.actorProfile.company_id;
    if (!accountId) {
      return jsonNoStore({ error: "Unable to determine account." }, 400);
    }

    const admin = createAdminClient();
    const { data: businesses, error: businessesError } = await admin
      .from("businesses")
      .select(
        "id, name, address_line1, city, state, postal_code, country, billing_status"
      )
      .eq("account_id", accountId)
      .order("name");

    if (businessesError) {
      return jsonNoStore(
        {
          error: "Unable to load businesses.",
          code: businessesError.code ?? null,
          details: businessesError.details ?? null,
          hint: businessesError.hint ?? null,
        },
        400
      );
    }

    return jsonNoStore({ businesses: businesses ?? [] }, 200);
  } catch {
    return jsonNoStore({ error: "Unexpected business listing failure." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAdminActor();
    if ("error" in context) return context.error;

    const body = (await request.json().catch(() => ({}))) as CreateBusinessBody;
    const name = (body.name ?? "").trim();

    if (!name) {
      return jsonNoStore({ error: "Business name is required." }, 400);
    }

    const accountId = context.actorProfile.account_id ?? context.actorProfile.company_id;
    if (!accountId) {
      return jsonNoStore({ error: "Unable to determine account." }, 400);
    }

    const admin = createAdminClient();
    const { data: created, error: createError } = await admin
      .from("businesses")
      .insert({
        account_id: accountId,
        name,
        address_line1: optionalString(body.address_line1),
        city: optionalString(body.city),
        state: optionalString(body.state),
        postal_code: optionalString(body.postal_code),
        country: optionalString(body.country),
        billing_status: "inactive",
      })
      .select("id, name")
      .single();

    if (createError || !created) {
      if (createError?.code === "23505") {
        return jsonNoStore(
          { error: "A business with that name already exists." },
          409
        );
      }

      return jsonNoStore(
        {
          error: "Unable to create business.",
          code: createError?.code ?? null,
          details: createError?.details ?? null,
          hint: createError?.hint ?? null,
        },
        400
      );
    }

    const { error: membershipError } = await admin
      .from("business_memberships")
      .upsert(
        {
          business_id: created.id,
          profile_id: context.actorProfile.id,
          role: membershipRoleForActor(context.actorProfile.role),
          is_active: true,
        },
        { onConflict: "business_id,profile_id" }
      );

    if (membershipError) {
      await admin.from("businesses").delete().eq("id", created.id);
      return jsonNoStore(
        {
          error: "Business created but creator membership could not be saved.",
          code: membershipError.code ?? null,
          details: membershipError.details ?? null,
          hint: membershipError.hint ?? null,
        },
        400
      );
    }

    return jsonNoStore(
      {
        business: {
          id: created.id,
          name: created.name,
        },
      },
      201
    );
  } catch {
    return jsonNoStore({ error: "Unexpected business creation failure." }, 500);
  }
}
