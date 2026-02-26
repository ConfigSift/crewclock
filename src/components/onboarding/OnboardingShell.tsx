import Link from "next/link";
import type { ReactNode } from "react";

type OnboardingStep = 1 | 2 | 3;

type OnboardingShellProps = {
  step: OnboardingStep;
  title: string;
  subtitle?: string;
  children: ReactNode;
  showBack?: boolean;
  onBackHref?: string;
};

const STEPS: OnboardingStep[] = [1, 2, 3];

function getStepClass(currentStep: OnboardingStep, dotStep: OnboardingStep): string {
  if (dotStep === currentStep) {
    return "border-accent bg-accent text-bg";
  }
  if (dotStep < currentStep) {
    return "border-accent/40 bg-accent/[0.12] text-accent";
  }
  return "border-border bg-bg text-text-muted";
}

function getBackHref(step: OnboardingStep, onBackHref?: string): string {
  if (onBackHref) return onBackHref;
  if (step === 3) return "/onboarding/step-2";
  return "/onboarding/step-1";
}

export default function OnboardingShell({
  step,
  title,
  subtitle,
  children,
  showBack = step > 1,
  onBackHref,
}: OnboardingShellProps) {
  const backHref = getBackHref(step, onBackHref);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-[560px] rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="mb-4">
          <div className="flex items-center justify-center gap-2">
            {STEPS.map((dotStep, index) => (
              <div key={dotStep} className="flex items-center gap-2">
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-black transition-colors ${getStepClass(
                    step,
                    dotStep
                  )}`}
                >
                  {dotStep}
                </span>
                {index < STEPS.length - 1 && (
                  <span
                    className={`block h-px w-8 ${
                      step > dotStep ? "bg-accent/40" : "bg-border"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {showBack && (
          <div className="mb-3">
            <Link
              href={backHref}
              className="text-sm font-semibold text-text-muted hover:text-text transition-colors"
            >
              Back
            </Link>
          </div>
        )}

        <h1 className="text-[28px] font-black tracking-tight text-text mb-1.5">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted mb-6">{subtitle}</p>}
        {children}
      </div>
    </main>
  );
}
