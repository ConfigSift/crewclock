import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import StepOneForm from "./StepOneForm";

type OnboardingProfile = {
  role?: "admin" | "manager" | "worker" | null;
  onboarding_step_completed?: number | null;
  first_name?: string | null;
  last_name?: string | null;
};

export default async function OnboardingStepOnePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const withOnboarding = await supabase
    .from("profiles")
    .select("role, onboarding_step_completed, first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  let profile: OnboardingProfile | null = null;

  if (!withOnboarding.error) {
    profile = (withOnboarding.data as OnboardingProfile | null) ?? null;
  } else {
    const fallback = await supabase
      .from("profiles")
      .select("role, first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();
    if (fallback.data) {
      profile = fallback.data as OnboardingProfile;
      profile.onboarding_step_completed = 0;
    }
  }

  if (!profile) {
    redirect("/login");
  }

  if (profile.role !== "admin") {
    redirect(profile.role === "worker" ? "/clock" : "/dashboard");
  }

  const onboardingStepCompleted = profile.onboarding_step_completed ?? 0;
  if (onboardingStepCompleted >= 3) {
    redirect("/dashboard");
  }

  if (onboardingStepCompleted >= 1) {
    redirect("/onboarding/step-2");
  }

  return (
    <OnboardingShell
      step={1}
      title="Onboarding"
      subtitle="Continue setup from step 1."
      showBack={false}
    >
      <StepOneForm
        initialFirstName={profile.first_name ?? ""}
        initialLastName={profile.last_name ?? ""}
      />
    </OnboardingShell>
  );
}
