import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generatePasscode,
  isValidPasscode,
  normalizePhone,
} from "@/lib/staff-utils";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type ResetPasscodeBody = {
  user_id?: string;
  phone?: string;
  passcode?: string;
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

async function getManagerContext() {
  const sessionClient = await createClient();

  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: actorProfile, error: profileError } = await sessionClient
    .from("profiles")
    .select("id, company_id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !actorProfile) {
    return {
      error: NextResponse.json(
        { error: "Unable to load your profile." },
        { status: 403 }
      ),
    };
  }

  if (actorProfile.role !== "manager" && actorProfile.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Manager or admin access required." },
        { status: 403 }
      ),
    };
  }

  return { sessionClient, actorProfile };
}

export async function POST(request: Request) {
  const context = await getManagerContext();
  if ("error" in context) return context.error;

  const { sessionClient, actorProfile } = context;
  const admin = createAdminClient();

  const body = (await request.json().catch(() => ({}))) as ResetPasscodeBody;
  const userId = (body.user_id ?? "").trim();

  if (!userId) {
    return jsonNoStore({ error: "user_id is required." }, 400);
  }

  const { data: targetProfile, error: targetError } = await sessionClient
    .from("profiles")
    .select("id, company_id, phone")
    .eq("id", userId)
    .single();

  if (targetError || !targetProfile || targetProfile.company_id !== actorProfile.company_id) {
    return jsonNoStore(
      { error: "Staff member not found in your company." },
      404
    );
  }

  const phone = normalizePhone(body.phone ?? targetProfile.phone);
  if (!phone) {
    return jsonNoStore(
      { error: "A valid phone number is required." },
      400
    );
  }

  const providedPasscode = (body.passcode ?? "").trim();
  const passcode = providedPasscode || generatePasscode();
  if (!isValidPasscode(passcode)) {
    return jsonNoStore(
      { error: "Passcode must be exactly 6 digits." },
      400
    );
  }

  const { data: authUserResult } = await admin.auth.admin.getUserById(userId);
  const userMetadata =
    (authUserResult.user?.user_metadata as Record<string, unknown> | undefined) ??
    {};

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    password: passcode,
    user_metadata: {
      ...userMetadata,
      phone,
    },
  });

  if (authError) {
    return jsonNoStore({ error: authError.message }, 400);
  }

  // IMPORTANT: use session-bound client for RPC so auth.uid() is the requester.
  console.info("[staff.reset] set_staff_passcode via session client", {
    requester_id: actorProfile.id,
    target_user_id: userId,
  });
  const { error: passcodeError } = await sessionClient.rpc("set_staff_passcode", {
    p_user_id: userId,
    p_phone: phone,
    p_passcode: passcode,
  });

  if (passcodeError) {
    return jsonNoStore(
      buildRpcErrorPayload(
        "set_staff_passcode",
        ["p_user_id", "p_phone", "p_passcode"],
        passcodeError
      ),
      400
    );
  }

  return jsonNoStore({ passcode, generated: !providedPasscode, phone }, 200);
}
