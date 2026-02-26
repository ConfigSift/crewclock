"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StepOneField = "first_name" | "last_name" | "business_name";
type FieldErrors = Partial<Record<StepOneField, string>>;

type FormState = {
  first_name: string;
  last_name: string;
  business_name: string;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

type StepOneFormProps = {
  initialFirstName: string;
  initialLastName: string;
};

function validateRequired(form: FormState): FieldErrors {
  const next: FieldErrors = {};
  if (!form.first_name.trim()) next.first_name = "First name is required.";
  if (!form.last_name.trim()) next.last_name = "Last name is required.";
  if (!form.business_name.trim()) next.business_name = "Business name is required.";
  return next;
}

export default function StepOneForm({
  initialFirstName,
  initialLastName,
}: StepOneFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState<FormState>({
    first_name: initialFirstName,
    last_name: initialLastName,
    business_name: "",
    address_line1: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
  });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const clientErrors = validateRequired(form);
    setFieldErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setLoading(true);
    try {
      const response = await fetch("/api/onboarding/step-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            nextPath?: string;
            fieldErrors?: FieldErrors;
          }
        | null;

      if (!response.ok) {
        setFieldErrors(payload?.fieldErrors ?? {});
        setError(payload?.error ?? "Unable to continue onboarding.");
        setLoading(false);
        return;
      }

      const nextPath =
        typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")
          ? payload.nextPath
          : "/onboarding/step-2";
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Unable to continue onboarding.");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
        First Name
      </label>
      <input
        type="text"
        value={form.first_name}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, first_name: event.target.value }))
        }
        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-1.5 focus:border-accent outline-none"
        required
      />
      {fieldErrors.first_name && (
        <p className="text-red text-xs font-semibold mb-3">{fieldErrors.first_name}</p>
      )}

      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
        Last Name
      </label>
      <input
        type="text"
        value={form.last_name}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, last_name: event.target.value }))
        }
        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-1.5 focus:border-accent outline-none"
        required
      />
      {fieldErrors.last_name && (
        <p className="text-red text-xs font-semibold mb-3">{fieldErrors.last_name}</p>
      )}

      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
        Business Name
      </label>
      <input
        type="text"
        value={form.business_name}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, business_name: event.target.value }))
        }
        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-1.5 focus:border-accent outline-none"
        required
      />
      {fieldErrors.business_name && (
        <p className="text-red text-xs font-semibold mb-3">{fieldErrors.business_name}</p>
      )}

      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
        Address Line 1 (Optional)
      </label>
      <input
        type="text"
        value={form.address_line1}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, address_line1: event.target.value }))
        }
        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-3.5 focus:border-accent outline-none"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div>
          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            City (Optional)
          </label>
          <input
            type="text"
            value={form.city}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, city: event.target.value }))
            }
            className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            State (Optional)
          </label>
          <input
            type="text"
            value={form.state}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, state: event.target.value }))
            }
            className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Postal Code (Optional)
          </label>
          <input
            type="text"
            value={form.postal_code}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, postal_code: event.target.value }))
            }
            className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Country (Optional)
          </label>
          <input
            type="text"
            value={form.country}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, country: event.target.value }))
            }
            className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
          />
        </div>
      </div>

      {error && (
        <p className="text-red text-sm font-semibold mt-4 mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full mt-5 p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}
