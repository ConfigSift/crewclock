import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubscriptionPriceId,
  mapStripeSubscriptionStatusToBillingStatus,
  retrieveSubscription,
} from "@/lib/billing/stripe";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
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
  name: string;
  account_id: string;
  billing_status:
    | "inactive"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid";
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
};

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-CrewClock-Billing": "v1",
    },
  });
}

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function resolvePlanLabel(priceId: string | null): string {
  if (!priceId) return "Not selected";
  const monthlyPriceId = process.env.STRIPE_PRICE_MONTHLY?.trim() ?? "";
  const annualPriceId = process.env.STRIPE_PRICE_ANNUAL?.trim() ?? "";
  if (monthlyPriceId && priceId === monthlyPriceId) return "Monthly ($19.99)";
  if (annualPriceId && priceId === annualPriceId) return "Annual ($199.99)";
  return "Custom";
}

async function resolveRouteParams(
  context: RouteContext
): Promise<{ id: string }> {
  const params = await context.params;
  return params as { id: string };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await resolveRouteParams(context);
    const businessId = id.trim();
    if (!businessId) {
      return jsonNoStore({ ok: false, error: "Business id is required." }, 400);
    }

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

    const admin = createAdminClient();
    const readBusiness = async () =>
      admin
        .from("businesses")
        .select(
          "id, name, account_id, billing_status, stripe_price_id, stripe_subscription_id, stripe_customer_id, cancel_at_period_end, current_period_start, current_period_end"
        )
        .eq("id", businessId)
        .single();

    const { data: business, error: businessError } = await readBusiness();
    if (businessError || !business) {
      return jsonNoStore({ ok: false, error: "Business not found." }, 404);
    }

    let businessRow = business as BusinessRow;
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore(
        { ok: false, error: "You do not have access to that business." },
        403
      );
    }

    const missingPeriodOrCancel =
      !businessRow.current_period_end ||
      typeof businessRow.cancel_at_period_end !== "boolean";

    if (businessRow.stripe_subscription_id && missingPeriodOrCancel) {
      try {
        const subscription = await retrieveSubscription(businessRow.stripe_subscription_id);
        const updates = {
          cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
          current_period_start: unixSecondsToIso(subscription.current_period_start),
          current_period_end: unixSecondsToIso(subscription.current_period_end),
          billing_status: mapStripeSubscriptionStatusToBillingStatus(subscription.status),
          stripe_price_id: getSubscriptionPriceId(subscription),
          stripe_subscription_id: subscription.id,
        };

        await admin.from("businesses").update(updates).eq("id", businessRow.id);

        const reread = await readBusiness();
        if (!reread.error && reread.data) {
          businessRow = reread.data as BusinessRow;
        }
      } catch {
        // Keep DB values if Stripe backfill fails.
      }
    }

    return jsonNoStore(
      {
        ok: true,
        business: {
          id: businessRow.id,
          name: businessRow.name,
          billing_status: businessRow.billing_status,
          stripe_price_id: businessRow.stripe_price_id,
          stripe_subscription_id: businessRow.stripe_subscription_id,
          stripe_customer_id: businessRow.stripe_customer_id,
          cancel_at_period_end: businessRow.cancel_at_period_end,
          current_period_start: businessRow.current_period_start,
          current_period_end: businessRow.current_period_end,
          plan_label: resolvePlanLabel(businessRow.stripe_price_id),
        },
      },
      200
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected billing lookup error.";
    return jsonNoStore({ ok: false, error: message }, 500);
  }
}
