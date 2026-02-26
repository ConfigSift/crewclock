import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import { BusinessProvider } from "@/contexts/BusinessContext";
import StepTwoContent from "./StepTwoContent";

type OnboardingProfile = {
  role?: "admin" | "manager" | "worker" | null;
  onboarding_step_completed?: number | null;
};

export default async function OnboardingStepTwoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const withOnboarding = await supabase
    .from("profiles")
    .select("role, onboarding_step_completed")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (withOnboarding.data as OnboardingProfile | null) ?? null;
  const role = profile?.role ?? null;
  const onboardingStepCompleted = profile?.onboarding_step_completed ?? 0;

  if (role !== "admin") {
    redirect(role === "worker" ? "/clock" : "/dashboard");
  }

  if (onboardingStepCompleted < 1) {
    redirect("/onboarding/step-1");
  }

  if (onboardingStepCompleted >= 3) {
    redirect("/dashboard");
  }

  if (onboardingStepCompleted >= 2) {
    redirect("/onboarding/step-3");
  }

  return (
    <OnboardingShell
      step={2}
      title="Add your crew (optional)"
      subtitle="You can also do this later from Dashboard - Crew."
      showBack
      onBackHref="/onboarding/step-1"
    >
      <BusinessProvider>
        <StepTwoContent />
      </BusinessProvider>
    </OnboardingShell>
  );
}
