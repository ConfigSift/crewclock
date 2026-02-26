import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type BusinessRow = {
  id: string;
  account_id: string;
};

type ProfileRow = {
  id: string;
  role: "admin" | "manager" | "worker";
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

function uniqueIds(rows: Array<{ profile_id?: string | null }>): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => row.profile_id ?? null)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actorContext = await requireAdminActor();
    if ("error" in actorContext) return actorContext.error;

    const { id: rawBusinessId } = await context.params;
    const businessId = (rawBusinessId ?? "").trim();

    if (!businessId) {
      return jsonNoStore({ error: "Business id is required." }, 400);
    }

    const actorAccountId =
      actorContext.actorProfile.account_id ?? actorContext.actorProfile.company_id;
    if (!actorAccountId) {
      return jsonNoStore({ error: "Unable to determine account." }, 400);
    }

    const admin = createAdminClient();

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, account_id")
      .eq("id", businessId)
      .maybeSingle();

    if (businessError || !business) {
      return jsonNoStore({ error: "Business not found." }, 404);
    }

    const businessRow = business as BusinessRow;

    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore(
        { error: "You do not have access to delete that business." },
        403
      );
    }

    const { data: memberships, error: membershipsError } = await admin
      .from("business_memberships")
      .select("profile_id")
      .eq("business_id", businessId);

    if (membershipsError) {
      return jsonNoStore({ error: "Unable to load business memberships." }, 400);
    }

    const memberIds = uniqueIds((memberships ?? []) as Array<{ profile_id?: string | null }>);

    let candidateStaffIds: string[] = [];
    if (memberIds.length > 0) {
      const { data: memberProfiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, role")
        .in("id", memberIds);

      if (profilesError) {
        return jsonNoStore({ error: "Unable to load membership profiles." }, 400);
      }

      candidateStaffIds = (memberProfiles ?? [])
        .map((row) => row as ProfileRow)
        .filter((row) => row.role === "worker" || row.role === "manager")
        .map((row) => row.id);
    }

    const { error: deleteBusinessError } = await admin
      .from("businesses")
      .delete()
      .eq("id", businessId);

    if (deleteBusinessError) {
      return jsonNoStore(
        {
          error: "Unable to delete business.",
          code: deleteBusinessError.code ?? null,
          details: deleteBusinessError.details ?? null,
          hint: deleteBusinessError.hint ?? null,
        },
        400
      );
    }

    let deletedStaffCount = 0;

    if (candidateStaffIds.length > 0) {
      const { data: remainingMemberships, error: remainingMembershipsError } = await admin
        .from("business_memberships")
        .select("profile_id")
        .in("profile_id", candidateStaffIds);

      if (remainingMembershipsError) {
        return jsonNoStore(
          {
            ok: true,
            deletedBusinessId: businessId,
            deletedStaffCount: 0,
            warning: "Business deleted, but unable to evaluate staff cleanup.",
          },
          200
        );
      }

      const remainingIds = new Set(uniqueIds(
        (remainingMemberships ?? []) as Array<{ profile_id?: string | null }>
      ));
      const orphanStaffIds = candidateStaffIds.filter((id) => !remainingIds.has(id));

      if (orphanStaffIds.length > 0) {
        const { error: profileDeleteError } = await admin
          .from("profiles")
          .delete()
          .in("id", orphanStaffIds);

        if (profileDeleteError) {
          return jsonNoStore(
            {
              ok: true,
              deletedBusinessId: businessId,
              deletedStaffCount: 0,
              warning: "Business deleted, but unable to delete orphan profiles.",
            },
            200
          );
        }

        for (const orphanId of orphanStaffIds) {
          const { error: authDeleteError } = await admin.auth.admin.deleteUser(orphanId);
          if (!authDeleteError) {
            deletedStaffCount += 1;
          }
        }
      }
    }

    return jsonNoStore(
      {
        ok: true,
        deletedBusinessId: businessId,
        deletedStaffCount,
      },
      200
    );
  } catch {
    return jsonNoStore({ error: "Unexpected business deletion failure." }, 500);
  }
}
