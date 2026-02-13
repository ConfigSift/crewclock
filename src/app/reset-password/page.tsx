"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (active) {
        setHasRecoverySession(Boolean(session));
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setHasRecoverySession(Boolean(session));
      }
      if (event === "SIGNED_OUT") {
        setHasRecoverySession(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!newPassword || !confirmPassword) {
      setError("Both password fields are required.");
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (hasRecoverySession === false) {
      setError("Open this page from your password reset email link.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await supabase.auth.signOut();
    setSuccess(true);
    setSaving(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 max-w-[440px] mx-auto">
      <div className="flex justify-end mb-3">
        <ThemeToggle />
      </div>

      <div className="text-center mb-10">
        <h1 className="text-[32px] font-black tracking-tight text-text">
          Reset Password
        </h1>
        <p className="text-sm text-text-muted mt-1 font-medium">
          Set a new password for your account
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border p-6">
        {success ? (
          <>
            <p className="text-green text-sm font-semibold mb-4 rounded-lg border border-green-border bg-green-dark px-3 py-2">
              Password updated successfully.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
            >
              Back to login
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {hasRecoverySession === false && (
              <p className="text-sm text-text-muted mb-4 rounded-lg border border-border bg-bg px-3 py-2">
                Open this page from your email reset link to set a new password.
              </p>
            )}

            <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
              New Password
            </label>
            <input
              type="password"
              className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
              placeholder="New password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={saving}
              required
            />

            <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-4 focus:border-accent outline-none"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={saving}
              required
            />

            {error && (
              <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
