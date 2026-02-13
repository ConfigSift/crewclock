import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type Body = {
  user_id?: string;
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

async function requireOwnerOrAdmin() {
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
    return {
      error: jsonNoStore({ error: "Unable to load your profile." }, 403),
    };
  }

  const { data: company } = await sessionClient
    .from("companies")
    .select("owner_user_id")
    .eq("id", actor.company_id)
    .single();

  const isOwner = company?.owner_user_id === actor.id;
  const isAdmin = actor.role === "admin";

  if (!isOwner && !isAdmin) {
    return {
      error: jsonNoStore({ error: "Owner or admin access required." }, 403),
    };
  }

  return { sessionClient, actorId: actor.id };
}

export async function POST(request: Request) {
  const context = await requireOwnerOrAdmin();
  if ("error" in context) return context.error;

  const { sessionClient, actorId } = context;
  const body = (await request.json().catch(() => ({}))) as Body;
  const userId = (body.user_id ?? "").trim();

  if (!userId) {
    return jsonNoStore({ error: "user_id is required." }, 400);
  }

  if (userId === actorId) {
    return jsonNoStore({ error: "Cannot delete your own account." }, 400);
  }

  // Session-bound RPC enforces auth.uid()-based ownership/role checks.
  const { error: rpcError } = await sessionClient.rpc("delete_staff", {
    p_user_id: userId,
  });

  if (rpcError) {
    return jsonNoStore(
      buildRpcErrorPayload("delete_staff", ["p_user_id"], rpcError),
      400
    );
  }

  const admin = createAdminClient();
  // Deleting auth.users cascades to public.profiles via FK ON DELETE CASCADE.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

  if (deleteError) {
    return jsonNoStore(
      {
        error: deleteError.message,
        details: null,
        hint: null,
        code: "AUTH_DELETE_FAILED",
      },
      400
    );
  }

  return jsonNoStore({ success: true }, 200);
}
