"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HardHat, Eye, EyeOff } from "lucide-react";
import { signUp, signIn } from "@/lib/actions";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    email: "",
    password: "",
    company: "",
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [isManager, setIsManager] = useState(false);

  const update = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const companyName = form.company.trim();
        const firstName = form.firstName.trim();
        const lastName = form.lastName.trim();
        const phone = form.phone.trim();
        const email = form.email.trim();
        const password = form.password;

        if (
          !companyName ||
          !firstName ||
          !lastName ||
          !phone ||
          !email ||
          !password
        ) {
          setError(
            "Please fill in Company Name, First Name, Last Name, Phone Number, Email, and Password."
          );
          setLoading(false);
          return;
        }

        const result = await signUp(email, password, {
          company_name: companyName,
          first_name: firstName,
          last_name: lastName,
          phone,
          role: isManager ? "manager" : "worker",
        });
        if (result.error) {
          setError(result.error);
          setLoading(false);
          return;
        }

        if (result.session) {
          router.push("/");
          router.refresh();
          return;
        }

        if (result.user) {
          const confirmationMessage =
            "Account created. Check your email to confirm your account.";
          console.info(confirmationMessage);
          setMessage(confirmationMessage);
          setMode("signin");
          setLoading(false);
          return;
        }

        setError("Signup completed but no session was returned.");
        setLoading(false);
        return;
      } else {
        const result = await signIn(form.email, form.password);
        if (result.error) {
          setError(result.error);
          setLoading(false);
          return;
        }
      }

      router.push("/");
      router.refresh();
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
      {/* Logo */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-[68px] h-[68px] bg-gradient-to-br from-accent to-accent-dark rounded-2xl mb-4 shadow-[0_8px_40px_var(--color-accent-glow)]">
          <HardHat size={34} className="text-bg" />
        </div>
        <h1 className="text-[32px] font-black tracking-tight text-text">
          CrewClock
        </h1>
        <p className="text-sm text-text-muted mt-1 font-medium">
          Construction Time Management
        </p>
      </div>

      {/* Form Card */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <>
              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Company Name
              </label>
              <input
                type="text"
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent focus:ring-2 focus:ring-accent-glow outline-none"
                placeholder="e.g. BuildRight Inc"
                value={form.company}
                onChange={(e) => update("company", e.target.value)}
              />

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    First Name
                  </label>
                  <input
                    type="text"
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
                    placeholder="John"
                    value={form.firstName}
                    onChange={(e) => update("firstName", e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Last Name
                  </label>
                  <input
                    type="text"
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
                    placeholder="Doe"
                    value={form.lastName}
                    onChange={(e) => update("lastName", e.target.value)}
                  />
                </div>
              </div>
              <div className="h-3.5" />

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Phone Number
              </label>
              <input
                type="tel"
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
                placeholder="(555) 123-4567"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </>
          )}

          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Email
          </label>
          <input
            type="email"
            className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
            placeholder="john@buildright.com"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            required
          />

          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Password
          </label>
          <div className="relative mb-4">
            <input
              type={showPassword ? "text" : "password"}
              className="w-full p-3 pr-10 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-muted transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {mode === "signup" && (
            <div
              className="flex items-center gap-2.5 mb-5 cursor-pointer select-none"
              onClick={() => setIsManager(!isManager)}
            >
              <div
                className={`w-[46px] h-[26px] rounded-full p-[3px] flex items-center transition-colors ${
                  isManager ? "bg-accent" : "bg-border"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
                    isManager ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </div>
              <span
                className={`text-sm font-semibold ${
                  isManager ? "text-accent" : "text-text-muted"
                }`}
              >
                I&apos;m a Manager / Foreman
              </span>
            </div>
          )}

          {error && (
            <p className="text-red text-sm font-semibold mb-3">{error}</p>
          )}
          {message && (
            <p className="text-green-600 text-sm font-semibold mb-3">{message}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold cursor-pointer shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Please wait..."
              : mode === "signin"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setMessage("");
            }}
            className="text-sm text-text-muted hover:text-accent transition-colors font-medium"
          >
            {mode === "signin"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-text-dim mt-5">
        Your session stays active until you sign out
      </p>
    </div>
  );
}
