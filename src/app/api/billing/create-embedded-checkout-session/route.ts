import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type BillingPlan,
  createEmbeddedSubscriptionCheckoutSession,
  createStripeCustomer,
  getSiteUrl,
  getStripePriceId,
} from "@/lib/billing/stripe";

type RequestBody = {
  business_id?: string;
  plan?: BillingPlan;
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
  name: string;
  stripe_customer_id: string | null;
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
      .select("id, role, company_id, account_id, is_active")
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

    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const businessId = (body.business_id ?? "").trim();
    const plan = body.plan;

    if (!businessId) {
      return jsonNoStore({ error: "business_id is required." }, 400);
    }
    if (plan !== "monthly" && plan !== "annual") {
      return jsonNoStore({ error: "plan must be 'monthly' or 'annual'." }, 400);
    }

    const admin = createAdminClient();
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, account_id, name, stripe_customer_id")
      .eq("id", businessId)
      .single();

    if (businessError || !business) {
      return jsonNoStore({ error: "Business not found." }, 404);
    }

    const businessRow = business as BusinessRow;
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore(
        { error: "You do not have access to that business." },
        403
      );
    }

    const priceId = getStripePriceId(plan);
    const siteUrl = getSiteUrl();
    const firstMonthPromoCodeId =
      process.env.STRIPE_PROMO_FIRSTMONTH1?.trim() ?? "";
    const shouldApplyFirstMonthDiscount = plan === "monthly";

    if (shouldApplyFirstMonthDiscount && !firstMonthPromoCodeId) {
      return jsonNoStore(
        { error: "Missing STRIPE_PROMO_FIRSTMONTH1 configuration." },
        500
      );
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("[billing] checkout session", {
        plan,
        discountApplied: shouldApplyFirstMonthDiscount,
      });
    }

    let customerId = businessRow.stripe_customer_id;
    if (!customerId) {
      const customer = await createStripeCustomer({
        email: user.email ?? null,
        name: businessRow.name,
        metadata: {
          business_id: businessRow.id,
          account_id: businessRow.account_id,
        },
      });
      customerId = customer.id;
      await admin
        .from("businesses")
        .update({ stripe_customer_id: customerId })
        .eq("id", businessRow.id);
    }

    const session = await createEmbeddedSubscriptionCheckoutSession({
      customerId,
      businessId: businessRow.id,
      accountId: businessRow.account_id,
      profileId: actorProfile.id,
      plan,
      priceId,
      returnUrl: `${siteUrl}/onboarding/step-3?session_id={CHECKOUT_SESSION_ID}`,
      promotionCodeId: shouldApplyFirstMonthDiscount
        ? firstMonthPromoCodeId
        : undefined,
    });

    if (!session.client_secret) {
      return jsonNoStore(
        { error: "Stripe did not return an embedded checkout client secret." },
        400
      );
    }

    return jsonNoStore(
      {
        clientSecret: session.client_secret,
        sessionId: session.id,
        plan,
      },
      200
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected billing error.";
    return jsonNoStore({ error: message }, 500);
  }
}
