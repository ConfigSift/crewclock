"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { HardHat, Eye, EyeOff } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
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
    <div className="min-h-screen flex flex-col justify-center px-6 max-w-[440px] mx-auto">
      <div className="flex justify-end mb-3">
        <ThemeToggle />
      </div>

      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-[68px] h-[68px] bg-gradient-to-br from-accent to-accent-dark rounded-2xl mb-4 shadow-[0_8px_40px_var(--color-accent-glow)]">
          <HardHat size={34} className="text-bg" />
        </div>
        <h1 className="text-[32px] font-black tracking-tight text-text">CrewClock</h1>
        <p className="text-sm text-text-muted mt-1 font-medium">
          Create your admin account
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border p-6">
        <form onSubmit={handleSignup}>
          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Email
          </label>
          <input
            type="email"
            className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
            placeholder="owner@company.com"
            value={form.email}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, email: event.target.value }))
            }
            required
          />

          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Password
          </label>
          <div className="relative mb-3.5">
            <input
              type={showPassword ? "text" : "password"}
              className="w-full p-3 pr-10 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-muted transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Confirm Password
          </label>
          <div className="relative mb-4">
            <input
              type={showConfirmPassword ? "text" : "password"}
              className="w-full p-3 pr-10 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-muted transition-colors"
              aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && (
            <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
              {error}
            </p>
          )}

          {success && (
            <p className="text-green text-sm font-semibold mb-3 rounded-lg border border-green-border bg-green-dark px-3 py-2">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold cursor-pointer shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        <p className="text-xs text-text-muted mt-4 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-accent font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
