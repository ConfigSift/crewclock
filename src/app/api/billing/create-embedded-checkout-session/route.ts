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
  price_id?: string;
  intent?: "existing_business" | "new_business";
  businessDraft?: {
    name?: string;
    address_line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  return_path?: string;
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

function optionalString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

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
    const requestedIntent = body.intent === "new_business" ? "new_business" : "existing_business";
    const requestedPlan = body.plan;
    const requestedPriceId = (body.price_id ?? "").trim();
    const requestedReturnPath = (
      body.return_path ??
      (requestedIntent === "new_business" ? "/dashboard/account" : "/onboarding/step-3")
    ).trim();
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    const admin = createAdminClient();

    const monthlyPriceId = getStripePriceId("monthly");
    const annualPriceId = getStripePriceId("annual");

    let resolvedPlan: BillingPlan | null = null;
    let resolvedPriceId = "";

    if (requestedPlan === "monthly" || requestedPlan === "annual") {
      resolvedPlan = requestedPlan;
      resolvedPriceId = getStripePriceId(requestedPlan);
    }

    if (requestedPriceId) {
      if (requestedPriceId === monthlyPriceId) {
        if (resolvedPlan && resolvedPlan !== "monthly") {
          return jsonNoStore({ error: "price_id does not match plan." }, 400);
        }
        resolvedPlan = "monthly";
        resolvedPriceId = monthlyPriceId;
      } else if (requestedPriceId === annualPriceId) {
        if (resolvedPlan && resolvedPlan !== "annual") {
          return jsonNoStore({ error: "price_id does not match plan." }, 400);
        }
        resolvedPlan = "annual";
        resolvedPriceId = annualPriceId;
      } else {
        return jsonNoStore({ error: "Unsupported price_id." }, 400);
      }
    }

    if (!resolvedPlan || !resolvedPriceId) {
      return jsonNoStore(
        { error: "Provide a valid plan ('monthly' or 'annual') or supported price_id." },
        400
      );
    }

    const siteUrl = getSiteUrl();
    const normalizedReturnPath = requestedReturnPath.startsWith("/")
      ? requestedReturnPath
      : requestedIntent === "new_business"
        ? "/dashboard/account"
        : "/onboarding/step-3";
    const returnUrl = new URL(normalizedReturnPath, `${siteUrl}/`);
    returnUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    const firstMonthPromoCodeId =
      process.env.STRIPE_PROMO_FIRSTMONTH1?.trim() ?? "";
    const shouldApplyFirstMonthDiscount = resolvedPlan === "monthly";

    if (shouldApplyFirstMonthDiscount && !firstMonthPromoCodeId) {
      return jsonNoStore(
        { error: "Missing STRIPE_PROMO_FIRSTMONTH1 configuration." },
        500
      );
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("[billing] checkout session", {
        plan: resolvedPlan,
        intent: requestedIntent,
        discountApplied: shouldApplyFirstMonthDiscount,
      });
    }

    let customerId = "";
    let resolvedBusinessId: string | null = null;
    let sessionMetadata: Record<string, string> = {
      intent: requestedIntent,
    };

    if (requestedIntent === "new_business") {
      const businessDraft = body.businessDraft ?? {};
      const draftName = optionalString(businessDraft.name);
      if (!draftName) {
        return jsonNoStore({ error: "businessDraft.name is required." }, 400);
      }

      const { data: existingByName, error: existingByNameError } = await admin
        .from("businesses")
        .select("id")
        .eq("account_id", actorAccountId)
        .ilike("name", draftName)
        .limit(1);

      if (existingByNameError) {
        return jsonNoStore({ error: "Unable to validate business name." }, 400);
      }
      if ((existingByName ?? []).length > 0) {
        return jsonNoStore({ error: "A business with that name already exists." }, 409);
      }

      const addressLine1 = optionalString(businessDraft.address_line1);
      const city = optionalString(businessDraft.city);
      const state = optionalString(businessDraft.state);
      const postalCode = optionalString(businessDraft.postal_code);
      const country = optionalString(businessDraft.country);

      const customer = await createStripeCustomer({
        email: user.email ?? null,
        name: draftName,
        metadata: {
          account_id: actorAccountId,
          profile_id: actorProfile.id,
          intent: "new_business",
          business_name: draftName,
        },
      });
      customerId = customer.id;
      sessionMetadata = {
        ...sessionMetadata,
        business_name: draftName,
        address_line1: addressLine1,
        city,
        state,
        postal_code: postalCode,
        country,
      };
    } else {
      if (!businessId) {
        return jsonNoStore({ error: "business_id is required." }, 400);
      }

      const { data: business, error: businessError } = await admin
        .from("businesses")
        .select("id, account_id, name, stripe_customer_id")
        .eq("id", businessId)
        .single();

      if (businessError || !business) {
        return jsonNoStore({ error: "Business not found." }, 404);
      }

      const businessRow = business as BusinessRow;
      if (businessRow.account_id !== actorAccountId) {
        return jsonNoStore(
          { error: "You do not have access to that business." },
          403
        );
      }

      resolvedBusinessId = businessRow.id;
      customerId = businessRow.stripe_customer_id ?? "";
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
    }

    const session = await createEmbeddedSubscriptionCheckoutSession({
      customerId,
      businessId: resolvedBusinessId,
      accountId: actorAccountId,
      profileId: actorProfile.id,
      plan: resolvedPlan,
      priceId: resolvedPriceId,
      returnUrl: returnUrl.toString(),
      promotionCodeId: shouldApplyFirstMonthDiscount
        ? firstMonthPromoCodeId
        : undefined,
      metadata: sessionMetadata,
    });

    if (!session.client_secret) {
      return jsonNoStore(
        { error: "Stripe did not return an embedded checkout client secret." },
        400
      );
    }

    return jsonNoStore(
      {
        client_secret: session.client_secret,
        checkout_session_id: session.id,
        clientSecret: session.client_secret,
        sessionId: session.id,
        plan: resolvedPlan,
      },
      200
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected billing error.";
    return jsonNoStore({ error: message }, 500);
  }
}
