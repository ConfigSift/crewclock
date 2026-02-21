import { NextRequest, NextResponse } from "next/server";
import { getStaffAuth } from "@/lib/staff-auth";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type Body = {
  user_id?: string;
  is_active?: boolean;
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

async function requireOwnerOrAdmin(req: NextRequest) {
  const { authMode, user, supabase } = await getStaffAuth(req);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "X-CrewClock-Auth-Mode": authMode } }
      ),
    };
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("id, role, company_id")
    .eq("id", user.id)
    .single();

  if (!actor) {
    return {
      error: jsonNoStore({ error: "Unable to load your profile." }, 403),
    };
  }

  const { data: company } = await supabase
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

  return { supabase, authMode };
}

export async function POST(req: NextRequest) {
  const context = await requireOwnerOrAdmin(req);
  if ("error" in context) return context.error;

  const { supabase, authMode } = context;
  const body = (await req.json().catch(() => ({}))) as Body;

  const userId = (body.user_id ?? "").trim();

  if (!userId || typeof body.is_active !== "boolean") {
    return jsonNoStore(
      { error: "user_id and boolean is_active are required." },
      400
    );
  }

  // Session-bound client keeps auth.uid() available for RPC authorization checks.
  const { error } = await supabase.rpc("set_staff_active", {
    p_user_id: userId,
    p_is_active: body.is_active,
  });

  if (error) {
    return jsonNoStore(
      buildRpcErrorPayload("set_staff_active", ["p_user_id", "p_is_active"], error),
      400
    );
  }

  const res = jsonNoStore({ success: true }, 200);
  res.headers.set("X-CrewClock-Auth-Mode", authMode);
  return res;
}
