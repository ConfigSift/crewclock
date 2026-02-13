import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

async function requireManagerOrAdmin() {
  const sessionClient = await createClient();

  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return { error: jsonNoStore({ error: "Unauthorized" }, 401) };
  }

  const { data: actor } = await sessionClient
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role !== "manager" && actor.role !== "admin")) {
    return {
      error: jsonNoStore({ error: "Manager or admin access required." }, 403),
    };
  }

  return { sessionClient };
}

export async function POST(request: Request) {
  const context = await requireManagerOrAdmin();
  if ("error" in context) return context.error;

  const { sessionClient } = context;
  const body = (await request.json().catch(() => ({}))) as Body;

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
  const { error } = await sessionClient.rpc("update_staff_profile", {
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

  return jsonNoStore({ success: true }, 200);
}
