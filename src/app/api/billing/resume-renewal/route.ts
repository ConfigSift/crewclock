import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubscriptionPriceId,
  mapStripeSubscriptionStatusToBillingStatus,
  updateSubscriptionCancelAtPeriodEnd,
} from "@/lib/billing/stripe";

type RequestBody = {
  business_id?: string;
};

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
  stripe_subscription_id: string | null;
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

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

export async function POST(request: Request) {
  try {
    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: actor, error: actorError } = await sessionClient
      .from("profiles")
      .select("id, role, company_id, account_id, is_active")
      .eq("id", user.id)
      .single();

    if (actorError || !actor) {
      return jsonNoStore({ ok: false, error: "Unable to load your profile." }, 403);
    }

    const actorProfile = actor as ActorProfile;
    if (!actorProfile.is_active) {
      return jsonNoStore({ ok: false, error: "Your account is inactive." }, 403);
    }
    if (actorProfile.role !== "admin") {
      return jsonNoStore({ ok: false, error: "Admin access required." }, 403);
    }

    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const businessId = (body.business_id ?? "").trim();
    if (!businessId) {
      return jsonNoStore({ ok: false, error: "business_id is required." }, 400);
    }

    const admin = createAdminClient();
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, account_id, stripe_subscription_id")
      .eq("id", businessId)
      .single();

    if (businessError || !business) {
      return jsonNoStore({ ok: false, error: "Business not found." }, 404);
    }

    const businessRow = business as BusinessRow;
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore(
        { ok: false, error: "You do not have access to that business." },
        403
      );
    }

    if (!businessRow.stripe_subscription_id) {
      return jsonNoStore(
        { ok: false, error: "No Stripe subscription is set for this business." },
        400
      );
    }

    const subscription = await updateSubscriptionCancelAtPeriodEnd(
      businessRow.stripe_subscription_id,
      false
    );
    const billingStatus = mapStripeSubscriptionStatusToBillingStatus(subscription.status);
    const priceId = getSubscriptionPriceId(subscription);
    const currentPeriodEnd = unixSecondsToIso(subscription.current_period_end);
    const currentPeriodStart = unixSecondsToIso(subscription.current_period_start);

    const { error: updateError } = await admin
      .from("businesses")
      .update({
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        current_period_end: currentPeriodEnd,
        current_period_start: currentPeriodStart,
        billing_status: billingStatus,
        stripe_price_id: priceId,
        stripe_subscription_id: subscription.id,
      })
      .eq("id", businessRow.id);

    if (updateError) {
      return jsonNoStore(
        {
          ok: false,
          error: "Unable to persist updated subscription state.",
        },
        400
      );
    }

    return jsonNoStore(
      {
        ok: true,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        current_period_end: currentPeriodEnd,
        current_period_start: currentPeriodStart,
        billing_status: billingStatus,
      },
      200
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected resume renewal error.";
    return jsonNoStore({ ok: false, error: message }, 500);
  }
}
