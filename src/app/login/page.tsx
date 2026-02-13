"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HardHat, Eye, EyeOff, KeyRound } from "lucide-react";
import { signIn } from "@/lib/actions";
import { isValidPasscode } from "@/lib/staff-utils";
import ThemeToggle from "@/components/ThemeToggle";

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
  const [mode, setMode] = useState<LoginMode>("admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
            Admin / Manager
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
              <div className="mb-3 rounded-lg border border-border bg-bg px-3 py-2">
                <p className="text-[11px] font-semibold text-text-muted">
                  Admin reminder: employees are created internally from Crew management.
                </p>
              </div>

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

      <p className="text-center text-xs text-text-dim mt-5">
        Accounts are created internally by your company admin.
      </p>
    </div>
  );
}
