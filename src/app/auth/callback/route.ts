import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureAdminProvisionedForUser } from "@/lib/auth/provision-admin";
import { getPostLoginPath, logPostLoginRedirect } from "@/lib/auth/post-login";

function withError(url: URL, message: string): URL {
  url.searchParams.set("error", message);
  return url;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = requestUrl.origin;
  const nextPath = requestUrl.searchParams.get("next");

  const fallbackUrl = new URL("/login", origin);

  if (!code) {
    return NextResponse.redirect(withError(fallbackUrl, "Missing auth code."));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(
      withError(fallbackUrl, "Unable to complete email verification.")
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(withError(fallbackUrl, "Authentication failed."));
  }

  const provisionResult = await ensureAdminProvisionedForUser(user.id, user.email);
  if (!provisionResult.ok) {
    return NextResponse.redirect(
      withError(
        fallbackUrl,
        provisionResult.error ?? "Could not complete account provisioning."
      )
    );
  }

  const withOnboarding = await supabase
    .from("profiles")
    .select("role, onboarding_step_completed")
    .eq("id", user.id)
    .maybeSingle();

  let role: "admin" | "manager" | "worker" | null = null;
  let onboardingStepCompleted: number | null = null;

  if (!withOnboarding.error && withOnboarding.data) {
    const typedProfile = withOnboarding.data as {
      role?: "admin" | "manager" | "worker" | null;
      onboarding_step_completed?: number | null;
    };
    role = typedProfile.role ?? null;
    onboardingStepCompleted = typedProfile.onboarding_step_completed ?? null;
  } else {
    const roleOnly = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    role =
      (roleOnly.data as { role?: "admin" | "manager" | "worker" | null } | null)
        ?.role ?? null;
  }

  const safeNextPath =
    typeof nextPath === "string" && nextPath.startsWith("/")
      ? nextPath
      : null;
  const fallbackPath = getPostLoginPath(role);
  const destination = new URL(safeNextPath ?? fallbackPath, origin);
  const effectiveOnboardingStep =
    onboardingStepCompleted ?? provisionResult.onboardingStepCompleted ?? 0;
  const shouldGoToOnboarding =
    role === "admin" &&
    effectiveOnboardingStep < 3 &&
    !destination.pathname.startsWith("/onboarding");

  if (shouldGoToOnboarding) {
    destination.pathname = "/onboarding/step-1";
    destination.search = "";
  }

  if (!safeNextPath) {
    logPostLoginRedirect("auth-callback", role, fallbackPath);
  }

  return NextResponse.redirect(destination);
}
