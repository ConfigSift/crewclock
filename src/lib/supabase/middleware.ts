import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPostLoginPath } from "@/lib/auth/post-login";

type ProfileSnapshot = {
  role?: "admin" | "manager" | "worker" | null;
  onboarding_step_completed?: number | null;
  company_id?: string | null;
  account_id?: string | null;
};

type BusinessBillingSnapshot = {
  id: string;
  account_id: string;
  billing_status:
    | "inactive"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid";
  cancel_at_period_end: boolean;
  current_period_end: string | null;
};

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  type CookieToSet = {
    name: string;
    value: string;
    options?: Parameters<typeof supabaseResponse.cookies.set>[2];
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const isDashboard = pathname.startsWith("/dashboard");
  const isOnboarding = pathname.startsWith("/onboarding");

  if (isApi) {
    return supabaseResponse;
  }

  if (!isDashboard && !isOnboarding) {
    return supabaseResponse;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const getProfileSnapshot = async (): Promise<ProfileSnapshot | null> => {
    if (!user) return null;
    const queryFilterId = user.id;

    const withOnboarding = await supabase
      .from("profiles")
      .select("role, onboarding_step_completed, company_id, account_id")
      .eq("id", queryFilterId)
      .single();

    if (!withOnboarding.error) {
      return (withOnboarding.data as ProfileSnapshot | null) ?? null;
    }

    if (withOnboarding.error.code === "PGRST116") {
      return null;
    }

    const errorMessage = withOnboarding.error.message ?? "";
    const onboardingColumnMissing =
      withOnboarding.error.code === "PGRST204" ||
      errorMessage.toLowerCase().includes("onboarding_step_completed");

    if (!onboardingColumnMissing) return null;

    const roleOnly = await supabase
      .from("profiles")
      .select("role, company_id, account_id")
      .eq("id", queryFilterId)
      .single();

    if (roleOnly.error || !roleOnly.data) return null;
    const roleOnlyData = roleOnly.data as {
      role?: ProfileSnapshot["role"];
      company_id?: string | null;
      account_id?: string | null;
    };
    return {
      role: roleOnlyData.role ?? null,
      onboarding_step_completed: null,
      company_id: roleOnlyData.company_id ?? null,
      account_id: roleOnlyData.account_id ?? null,
    };
  };

  const redirectWithSessionCookies = (url: URL) => {
    const response = NextResponse.redirect(url);
    const refreshedCookies = supabaseResponse.cookies.getAll();
    refreshedCookies.forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value);
    });
    return response;
  };

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return redirectWithSessionCookies(url);
  }

  const profile = await getProfileSnapshot();
  const needsOnboarding =
    profile?.role === "admin" && (profile.onboarding_step_completed ?? 0) < 3;

  if (needsOnboarding && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding/step-1";
    return redirectWithSessionCookies(url);
  }

  if (isDashboard) {
    const accountPagePath =
      pathname === "/dashboard/account" || pathname.startsWith("/dashboard/account/");
    if (profile?.role === "worker" && !accountPagePath) {
      const url = request.nextUrl.clone();
      url.pathname = "/clock";
      return redirectWithSessionCookies(url);
    }

    if (!accountPagePath) {
      const selectedBusinessCookie = request.cookies.get("crewclock.activeBusinessId")?.value;
      let selectedBusinessId = "";
      if (selectedBusinessCookie) {
        try {
          selectedBusinessId = decodeURIComponent(selectedBusinessCookie).trim();
        } catch {
          selectedBusinessId = selectedBusinessCookie.trim();
        }
      }

      if (!selectedBusinessId) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard/account";
        url.searchParams.set("billing", "required");
        return redirectWithSessionCookies(url);
      }

      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select(
          "id, account_id, billing_status, cancel_at_period_end, current_period_end"
        )
        .eq("id", selectedBusinessId)
        .maybeSingle();

      const businessSnapshot = (business as BusinessBillingSnapshot | null) ?? null;
      const actorAccountId = profile?.account_id ?? profile?.company_id ?? null;
      const accountMatches =
        !!businessSnapshot && !!actorAccountId && businessSnapshot.account_id === actorAccountId;

      if (businessError || !businessSnapshot || !accountMatches) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard/account";
        url.searchParams.set("billing", "required");
        return redirectWithSessionCookies(url);
      }

      const billingStatusEligible =
        businessSnapshot.billing_status === "active" ||
        businessSnapshot.billing_status === "trialing";

      let graceWindowEligible = false;
      if (businessSnapshot.cancel_at_period_end && businessSnapshot.current_period_end) {
        const periodEndTime = Date.parse(businessSnapshot.current_period_end);
        graceWindowEligible =
          Number.isFinite(periodEndTime) && Date.now() < periodEndTime;
      }

      if (!billingStatusEligible && !graceWindowEligible) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard/account";
        url.searchParams.set("billing", "required");
        return redirectWithSessionCookies(url);
      }
    }
  }

  if (isOnboarding && profile && profile.role !== "admin") {
    const dest = getPostLoginPath(profile.role);
    const url = request.nextUrl.clone();
    url.pathname = dest;
    return redirectWithSessionCookies(url);
  }

  return supabaseResponse;
}
