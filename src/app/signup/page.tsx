"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { createClient } from "@/lib/supabase/client";

function resolveSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/$/, "");
  }

  return "";
}

export default function SignupPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const email = form.email.trim();
    const password = form.password;
    const confirmPassword = form.confirmPassword;

    if (!email || !password || !confirmPassword) {
      setError("Email, password, and confirm password are required.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const siteUrl = resolveSiteUrl();
    if (!siteUrl) {
      setError("Missing app URL configuration.");
      return;
    }

    setLoading(true);

    const { data: signupData, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });

    if (signupError) {
      console.error("[signup] auth.signUp error", signupError);
      setError(signupError.message);
      setLoading(false);
      return;
    }

    if (!signupData.user) {
      console.error("[signup] auth.signUp returned no user", signupData);
      setError("Unable to complete signup. Please try again.");
      setLoading(false);
      return;
    }

    setSuccess("Check your email to confirm.");
    setLoading(false);
    setForm((prev) => ({ ...prev, password: "", confirmPassword: "" }));
  };

  return (
    <AuthShell pageLabel="Create account">
      <div className="rounded-3xl border border-border bg-card px-5 py-6 shadow-[0_18px_46px_rgba(52,38,18,0.12)] sm:px-7 sm:py-7">
        <div className="mb-6">
          <h2 className="text-[29px] font-black tracking-tight text-text">Create account</h2>
          <p className="mt-1 text-sm font-medium text-text-muted">
            Set up your admin account and continue onboarding.
          </p>
        </div>

        <form onSubmit={handleSignup}>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Email
          </label>
          <input
            type="email"
            className="mb-3.5 w-full rounded-xl border border-border bg-bg p-3 text-sm text-text outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
            placeholder="owner@company.com"
            value={form.email}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, email: event.target.value }))
            }
            required
          />

          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Password
          </label>
          <div className="relative mb-3.5">
            <input
              type={showPassword ? "text" : "password"}
              className="w-full rounded-xl border border-border bg-bg p-3 pr-10 text-sm text-text outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
              placeholder="Password"
              value={form.password}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, password: event.target.value }))
              }
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim transition-colors hover:text-text-muted"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Confirm Password
          </label>
          <div className="relative mb-4">
            <input
              type={showConfirmPassword ? "text" : "password"}
              className="w-full rounded-xl border border-border bg-bg p-3 pr-10 text-sm text-text outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
              placeholder="Confirm password"
              value={form.confirmPassword}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  confirmPassword: event.target.value,
                }))
              }
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim transition-colors hover:text-text-muted"
              aria-label={
                showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"
              }
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && (
            <p className="mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2 text-sm font-semibold text-red">
              {error}
            </p>
          )}

          {success && (
            <p className="mb-3 rounded-lg border border-green-border bg-green-dark px-3 py-2 text-sm font-semibold text-green">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full cursor-pointer rounded-xl bg-gradient-to-br from-accent to-accent-dark p-3.5 text-[15px] font-extrabold text-bg shadow-[0_4px_20px_var(--color-accent-glow)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_28px_var(--color-accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
