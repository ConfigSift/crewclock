"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { signIn } from "@/lib/actions";
import { isValidPasscode } from "@/lib/staff-utils";
import AuthShell from "@/components/auth/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { getPostLoginPath, logPostLoginRedirect } from "@/lib/auth/post-login";

type LoginMode = "admin" | "employee";

function formatApiError(
  payload: {
    error?: string;
    code?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null,
  fallback: string
): string {
  if (!payload) return fallback;
  const parts = [payload.error || fallback];
  if (payload.code) parts.push(`Code: ${payload.code}`);
  if (payload.details) parts.push(`Details: ${payload.details}`);
  if (payload.hint) parts.push(`Hint: ${payload.hint}`);
  return parts.join(" ");
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [mode, setMode] = useState<LoginMode>("admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const callbackError = searchParams.get("error")?.trim() ?? "";

  const [adminForm, setAdminForm] = useState({ email: "", password: "" });
  const [employeeForm, setEmployeeForm] = useState({ phone: "", passcode: "" });

  const resolvePostLoginPath = async (): Promise<string> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return "/";

    const withOnboarding = await supabase
      .from("profiles")
      .select("role, onboarding_step_completed")
      .eq("id", user.id)
      .maybeSingle();

    let role: "admin" | "manager" | "worker" | null = null;
    let onboardingStepCompleted: number | null = null;

    if (!withOnboarding.error && withOnboarding.data) {
      const profile = withOnboarding.data as {
        role?: "admin" | "manager" | "worker" | null;
        onboarding_step_completed?: number | null;
      };
      role = profile.role ?? null;
      onboardingStepCompleted = profile.onboarding_step_completed ?? null;
    } else {
      const fallback = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (fallback.data) {
        role =
          (fallback.data as { role?: "admin" | "manager" | "worker" | null }).role ??
          null;
      }
    }

    if (role === "admin" && (onboardingStepCompleted ?? 0) < 3) {
      return "/onboarding/step-1";
    }

    const destination = getPostLoginPath(role);
    logPostLoginRedirect("login-submit", role, destination);
    return destination;
  };

  const handleAdminSignIn = async (): Promise<boolean> => {
    const email = adminForm.email.trim();
    const password = adminForm.password;

    if (!email || !password) {
      setError("Email and password are required.");
      return false;
    }

    const result = await signIn(email, password);
    if (result.error) {
      setError(result.error);
      return false;
    }

    return true;
  };

  const handleEmployeeSignIn = async (): Promise<boolean> => {
    const phone = employeeForm.phone.trim();
    const passcode = employeeForm.passcode.trim();

    if (!phone || !isValidPasscode(passcode)) {
      setError("Phone number and a 6-digit passcode are required.");
      return false;
    }

    const response = await fetch("/api/auth/employee-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, passcode }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          code?: string | null;
          details?: string | null;
          hint?: string | null;
        }
      | null;

    if (!response.ok) {
      setError(formatApiError(payload, "Login failed."));
      return false;
    }

    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const success =
        mode === "admin"
          ? await handleAdminSignIn()
          : await handleEmployeeSignIn();

      if (success) {
        const destination = await resolvePostLoginPath();
        router.replace(destination);
        router.refresh();
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSendReset = async () => {
    const email = (resetEmail || adminForm.email).trim();
    if (!email) {
      setResetError("Email is required.");
      setResetSuccess("");
      return;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    if (!appUrl) {
      setResetError("Missing NEXT_PUBLIC_APP_URL configuration.");
      setResetSuccess("");
      return;
    }

    setResetLoading(true);
    setResetError("");
    setResetSuccess("");

    const { error: resetRequestError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${appUrl}/reset-password`,
      }
    );

    if (resetRequestError) {
      setResetError(resetRequestError.message);
      setResetLoading(false);
      return;
    }

    setResetSuccess("Password reset link sent if the email exists.");
    setResetLoading(false);
  };

  return (
    <>
      <AuthShell pageLabel="Sign in">
        <div className="rounded-3xl border border-border bg-card px-5 py-6 shadow-[0_18px_46px_rgba(52,38,18,0.12)] sm:px-7 sm:py-7">
          <div className="mb-6">
            <h2 className="text-[29px] font-black tracking-tight text-text">Welcome back</h2>
            <p className="mt-1 text-sm font-medium text-text-muted">
              Sign in to manage crew hours and daily job site activity.
            </p>
          </div>

          <div className="mb-5 flex gap-1.5 rounded-xl bg-bg p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode("admin");
                setError("");
              }}
              className={`flex-1 rounded-lg py-2.5 text-[13px] font-semibold transition-all ${
                mode === "admin"
                  ? "bg-card text-accent shadow-[0_6px_16px_rgba(52,38,18,0.08)]"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Manager
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("employee");
                setError("");
              }}
              className={`flex-1 rounded-lg py-2.5 text-[13px] font-semibold transition-all ${
                mode === "employee"
                  ? "bg-card text-accent shadow-[0_6px_16px_rgba(52,38,18,0.08)]"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Employee
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === "admin" ? (
              <>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  Email
                </label>
                <input
                  type="email"
                  className="mb-3.5 w-full rounded-xl border border-border bg-bg p-3 text-sm text-text outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                  placeholder="manager@company.com"
                  value={adminForm.email}
                  onChange={(event) =>
                    setAdminForm((prev) => ({ ...prev, email: event.target.value }))
                  }
                  required
                />

                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  Password
                </label>
                <div className="relative mb-4">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full rounded-xl border border-border bg-bg p-3 pr-10 text-sm text-text outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                    placeholder="Password"
                    value={adminForm.password}
                    onChange={(event) =>
                      setAdminForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim transition-colors hover:text-text-muted"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(true);
                    setResetEmail(adminForm.email.trim());
                    setResetError("");
                    setResetSuccess("");
                  }}
                  className="mb-4 text-xs font-semibold text-text-muted hover:text-text"
                >
                  Forgot password?
                </button>
              </>
            ) : (
              <>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  Phone Number
                </label>
                <input
                  type="tel"
                  className="mb-3.5 w-full rounded-xl border border-border bg-bg p-3 text-sm text-text outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                  placeholder="(555) 123-4567"
                  value={employeeForm.phone}
                  onChange={(event) =>
                    setEmployeeForm((prev) => ({ ...prev, phone: event.target.value }))
                  }
                  required
                />

                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  6-Digit Passcode
                </label>
                <div className="relative mb-4">
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    className="w-full rounded-xl border border-border bg-bg p-3 pr-10 font-mono text-sm tracking-[0.3em] text-text outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                    placeholder="000000"
                    value={employeeForm.passcode}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({
                        ...prev,
                        passcode: event.target.value.replace(/\D/g, "").slice(0, 6),
                      }))
                    }
                    required
                  />
                  <KeyRound
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim"
                  />
                </div>
                <p className="mb-4 text-xs text-text-muted">
                  Forgot passcode? Ask your manager.
                </p>
              </>
            )}

            {error && (
              <p className="mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2 text-sm font-semibold text-red">
                {error}
              </p>
            )}
            {callbackError && !error && (
              <p className="mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2 text-sm font-semibold text-red">
                {callbackError}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full cursor-pointer rounded-xl bg-gradient-to-br from-accent to-accent-dark p-3.5 text-[15px] font-extrabold text-bg shadow-[0_4px_20px_var(--color-accent-glow)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_28px_var(--color-accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Please wait..." : "Sign In"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-text-muted">
            Need an admin account?{" "}
            <Link href="/signup" className="font-semibold text-accent hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </AuthShell>

      {showForgotPassword && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          onClick={() => {
            if (resetLoading) return;
            setShowForgotPassword(false);
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative w-full max-w-[460px] animate-scale-in rounded-2xl border border-border bg-card"
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-[17px] font-bold">Reset password</h3>
              <button
                onClick={() => setShowForgotPassword(false)}
                disabled={resetLoading}
                className="text-sm font-semibold text-text-muted hover:text-text disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="mb-3 text-sm text-text-muted">
                Enter your email and we&apos;ll send a password reset link.
              </p>

              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
                Email
              </label>
              <input
                type="email"
                className="mb-3.5 w-full rounded-lg border border-border bg-bg p-3 text-sm text-text outline-none focus:border-accent"
                placeholder="manager@company.com"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                disabled={resetLoading}
              />

              {resetError && (
                <p className="mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2 text-sm font-semibold text-red">
                  {resetError}
                </p>
              )}

              {resetSuccess && (
                <p className="mb-3 rounded-lg border border-green-border bg-green-dark px-3 py-2 text-sm font-semibold text-green">
                  {resetSuccess}
                </p>
              )}

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(false)}
                  disabled={resetLoading}
                  className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold text-text-muted transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendReset}
                  disabled={resetLoading}
                  className="flex-[2] rounded-xl bg-gradient-to-br from-accent to-accent-dark py-3 text-sm font-extrabold text-bg shadow-[0_4px_20px_var(--color-accent-glow)] transition-all hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {resetLoading ? "Sending..." : "Send reset link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
