import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type Body = {
  user_id?: string;
  role?: "worker" | "manager";
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

  return { sessionClient };
}

export async function POST(request: Request) {
  const context = await requireOwnerOrAdmin();
  if ("error" in context) return context.error;

  const { sessionClient } = context;
  const body = (await request.json().catch(() => ({}))) as Body;

  const userId = (body.user_id ?? "").trim();
  const role = body.role;

  if (!userId || (role !== "worker" && role !== "manager")) {
    return jsonNoStore({ error: "user_id and valid role are required." }, 400);
  }

  // Session-bound client keeps auth.uid() available for RPC authorization checks.
  const { error } = await sessionClient.rpc("update_staff_role", {
    p_user_id: userId,
    p_role: role,
  });

  if (error) {
    return jsonNoStore(
      buildRpcErrorPayload("update_staff_role", ["p_user_id", "p_role"], error),
      400
    );
  }

  return jsonNoStore({ success: true }, 200);
}
