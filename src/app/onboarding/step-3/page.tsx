import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import { BusinessProvider } from "@/contexts/BusinessContext";
import StepThreeContent from "./StepThreeContent";

type OnboardingProfile = {
  role?: "admin" | "manager" | "worker" | null;
  onboarding_step_completed?: number | null;
};

export default async function OnboardingStepThreePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, onboarding_step_completed")
    .eq("id", user.id)
    .maybeSingle();

  const typedProfile = (profile as OnboardingProfile | null) ?? null;
  const role = typedProfile?.role ?? null;
  const onboardingStepCompleted = typedProfile?.onboarding_step_completed ?? 0;

  if (role !== "admin") {
    redirect(role === "worker" ? "/clock" : "/dashboard");
  }

  if (onboardingStepCompleted < 2) {
    redirect("/onboarding/step-2");
  }

  if (onboardingStepCompleted >= 3) {
    redirect("/dashboard");
  }

  return (
    <OnboardingShell
      step={3}
      title="Choose your plan"
      subtitle="Pick monthly or annual billing, then complete secure checkout."
      showBack
      onBackHref="/onboarding/step-2"
    >
      <BusinessProvider>
        <StepThreeContent />
      </BusinessProvider>
    </OnboardingShell>
  );
}
