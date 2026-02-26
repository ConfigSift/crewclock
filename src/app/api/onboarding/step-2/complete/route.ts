import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type CompleteStepTwoBody = {
  business_id?: string;
};

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
  onboarding_step_completed: number | null;
};

type BusinessRecord = {
  id: string;
  account_id: string;
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

export async function POST(request: Request) {
  try {
    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      return jsonNoStore({ error: "Unauthorized" }, 401);
    }

    const { data: actor, error: actorError } = await sessionClient
      .from("profiles")
      .select("id, role, company_id, account_id, is_active, onboarding_step_completed")
      .eq("id", user.id)
      .single();

    if (actorError || !actor) {
      return jsonNoStore({ error: "Unable to load your profile." }, 403);
    }

    const actorProfile = actor as ActorProfile;

    if (!actorProfile.is_active) {
      return jsonNoStore({ error: "Your account is inactive." }, 403);
    }

    if (actorProfile.role !== "admin") {
      return jsonNoStore({ error: "Admin access required." }, 403);
    }

    const currentStep = actorProfile.onboarding_step_completed ?? 0;
    if (currentStep < 1) {
      return jsonNoStore(
        { error: "Complete onboarding step 1 before continuing." },
        409
      );
    }

    const body = (await request.json().catch(() => ({}))) as CompleteStepTwoBody;
    const businessId = (body.business_id ?? "").trim();
    if (!businessId) {
      return jsonNoStore({ error: "business_id is required." }, 400);
    }

    const admin = createAdminClient();
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, account_id")
      .eq("id", businessId)
      .single();

    if (businessError || !business) {
      return jsonNoStore({ error: "Business not found." }, 404);
    }

    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    if ((business as BusinessRecord).account_id !== actorAccountId) {
      return jsonNoStore(
        { error: "You do not have access to that business." },
        403
      );
    }

    if (currentStep < 2) {
      const { error: updateError } = await admin
        .from("profiles")
        .update({ onboarding_step_completed: 2 })
        .eq("id", actorProfile.id);

      if (updateError) {
        return jsonNoStore(
          {
            error: "Unable to update onboarding progress.",
            code: updateError.code ?? null,
            details: updateError.details ?? null,
            hint: updateError.hint ?? null,
          },
          400
        );
      }
    }

    return jsonNoStore(
      {
        ok: true,
        onboarding_step_completed: Math.max(currentStep, 2),
        nextPath: currentStep >= 3 ? "/dashboard" : "/onboarding/step-3",
      },
      200
    );
  } catch {
    return jsonNoStore({ error: "Unexpected onboarding step 2 failure." }, 500);
  }
}
