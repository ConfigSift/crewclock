import { NextRequest, NextResponse } from "next/server";
import { getStaffAuth } from "@/lib/staff-auth";
import { normalizePhone } from "@/lib/staff-utils";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type Body = {
  user_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
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

async function requireManagerOrAdmin(req: NextRequest) {
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
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role !== "manager" && actor.role !== "admin")) {
    return {
      error: jsonNoStore({ error: "Manager or admin access required." }, 403),
    };
  }

  return { supabase, authMode };
}

export async function POST(req: NextRequest) {
  const context = await requireManagerOrAdmin(req);
  if ("error" in context) return context.error;

  const { supabase, authMode } = context;
  const body = (await req.json().catch(() => ({}))) as Body;

  const userId = (body.user_id ?? "").trim();
  const firstName = (body.first_name ?? "").trim();
  const lastName = (body.last_name ?? "").trim();
  const phone = normalizePhone(body.phone ?? "");

  if (!userId || !firstName || !lastName || !phone) {
    return jsonNoStore(
      { error: "user_id, first_name, last_name, and valid phone are required." },
      400
    );
  }

  // Session-bound client keeps auth.uid() available for RPC authorization checks.
  const { error } = await supabase.rpc("update_staff_profile", {
    p_user_id: userId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_phone: phone,
  });

  if (error) {
    return jsonNoStore(
      buildRpcErrorPayload(
        "update_staff_profile",
        ["p_user_id", "p_first_name", "p_last_name", "p_phone"],
        error
      ),
      400
    );
  }

  const res = jsonNoStore({ success: true }, 200);
  res.headers.set("X-CrewClock-Auth-Mode", authMode);
  return res;
}
