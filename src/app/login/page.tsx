"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HardHat, Eye, EyeOff, KeyRound } from "lucide-react";
import { signIn } from "@/lib/actions";
import { isValidPasscode } from "@/lib/staff-utils";
import ThemeToggle from "@/components/ThemeToggle";
import { createClient } from "@/lib/supabase/client";

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

  const [adminForm, setAdminForm] = useState({ email: "", password: "" });
  const [employeeForm, setEmployeeForm] = useState({ phone: "", passcode: "" });

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
        router.push("/");
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
    <div className="min-h-screen flex flex-col justify-center px-6 max-w-[440px] mx-auto">
      <div className="flex justify-end mb-3">
        <ThemeToggle />
      </div>

      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-[68px] h-[68px] bg-gradient-to-br from-accent to-accent-dark rounded-2xl mb-4 shadow-[0_8px_40px_var(--color-accent-glow)]">
          <HardHat size={34} className="text-bg" />
        </div>
        <h1 className="text-[32px] font-black tracking-tight text-text">CrewClock</h1>
        <p className="text-sm text-text-muted mt-1 font-medium">Construction Time Management</p>
      </div>

      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex gap-1 bg-bg p-1 rounded-xl mb-5">
          <button
            type="button"
            onClick={() => {
              setMode("admin");
              setError("");
            }}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
              mode === "admin" ? "bg-card text-accent" : "text-text-muted"
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
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
              mode === "employee" ? "bg-card text-accent" : "text-text-muted"
            }`}
          >
            Employee
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "admin" ? (
            <>
              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Email
              </label>
              <input
                type="email"
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
                placeholder="manager@company.com"
                value={adminForm.email}
                onChange={(event) =>
                  setAdminForm((prev) => ({ ...prev, email: event.target.value }))
                }
                required
              />

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Password
              </label>
              <div className="relative mb-4">
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full p-3 pr-10 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-muted transition-colors"
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
                className="text-xs font-semibold text-text-muted hover:text-text mb-4"
              >
                Forgot password?
              </button>
            </>
          ) : (
            <>
              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Phone Number
              </label>
              <input
                type="tel"
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
                placeholder="(555) 123-4567"
                value={employeeForm.phone}
                onChange={(event) =>
                  setEmployeeForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                required
              />

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                6-Digit Passcode
              </label>
              <div className="relative mb-4">
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="w-full p-3 pr-10 bg-bg border border-border rounded-lg text-text text-sm font-mono tracking-[0.3em] focus:border-accent outline-none"
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
              <p className="text-xs text-text-muted mb-4">
                Forgot passcode? Ask your manager.
              </p>
            </>
          )}

          {error && (
            <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold cursor-pointer shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Please wait..." : "Sign In"}
          </button>
        </form>
      </div>

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
            className="relative bg-card rounded-2xl border border-border w-full max-w-[460px] animate-scale-in"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="text-[17px] font-bold">Reset password</h3>
              <button
                onClick={() => setShowForgotPassword(false)}
                disabled={resetLoading}
                className="text-text-muted hover:text-text text-sm font-semibold disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm text-text-muted mb-3">
                Enter your email and we'll send a password reset link.
              </p>

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Email
              </label>
              <input
                type="email"
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
                placeholder="manager@company.com"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                disabled={resetLoading}
              />

              {resetError && (
                <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
                  {resetError}
                </p>
              )}

              {resetSuccess && (
                <p className="text-green text-sm font-semibold mb-3 rounded-lg border border-green-border bg-green-dark px-3 py-2">
                  {resetSuccess}
                </p>
              )}

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(false)}
                  disabled={resetLoading}
                  className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendReset}
                  disabled={resetLoading}
                  className="flex-[2] py-3 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-sm font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
                >
                  {resetLoading ? "Sending..." : "Send reset link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
