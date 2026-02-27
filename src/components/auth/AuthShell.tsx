import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, Clock3, HardHat, MapPin, ShieldCheck } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

type AuthShellProps = {
  children: ReactNode;
  pageLabel: string;
};

const benefits = [
  {
    icon: MapPin,
    title: "Location-aware clock-ins",
    body: "Capture hours only when crews are on the job site.",
  },
  {
    icon: Clock3,
    title: "Accurate daily totals",
    body: "Track clean start and end times with less manual cleanup.",
  },
  {
    icon: ShieldCheck,
    title: "Verified records",
    body: "Keep audit-ready entries for manager approval and payroll.",
  },
];

const trustChips = ["Geofenced", "Manager approvals", "Payroll-ready"];

export default function AuthShell({ children, pageLabel }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6f2ea] text-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 75% 20%, rgba(245,180,80,0.18), transparent 48%), radial-gradient(circle at 20% 75%, rgba(245,180,80,0.1), transparent 40%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.36]"
        style={{
          backgroundImage: "radial-gradient(rgba(125, 102, 72, 0.24) 0.8px, transparent 0.8px)",
          backgroundSize: "18px 18px",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-[1160px] flex-col px-5 py-7 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
        <div className="mb-6 flex items-center justify-between lg:mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-text-muted transition-colors hover:text-text"
          >
            <ChevronLeft size={16} />
            Back to home
          </Link>
          <ThemeToggle />
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(430px,520px)] lg:gap-10">
          <section className="hidden rounded-3xl border border-border/80 bg-card/65 p-9 shadow-[0_20px_55px_rgba(52,38,18,0.09)] backdrop-blur-[2px] lg:block">
            <div className="mb-9">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-dark text-bg shadow-[0_10px_30px_var(--color-accent-glow)]">
                <HardHat size={28} />
              </div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-text-muted">
                CrewClock
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-tight text-text">
                Accurate time. Verified location.
              </h1>
              <p className="mt-3 text-base font-medium text-text-muted">
                Clock in only when you&apos;re on site.
              </p>
            </div>

            <ul className="space-y-4">
              {benefits.map((item) => (
                <li key={item.title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-bg/80 text-accent">
                    <item.icon size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-text">{item.title}</p>
                    <p className="mt-0.5 text-sm text-text-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-2.5">
              {trustChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-border/80 bg-bg/90 px-3.5 py-1.5 text-xs font-semibold text-text-muted"
                >
                  {chip}
                </span>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-4 rounded-3xl border border-border/80 bg-card/90 px-5 py-5 shadow-[0_12px_35px_rgba(52,38,18,0.08)] backdrop-blur-[2px] lg:hidden">
              <div className="flex items-center gap-3.5">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-dark text-bg shadow-[0_8px_24px_var(--color-accent-glow)]">
                  <HardHat size={22} />
                </span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                    CrewClock
                  </p>
                  <h1 className="text-xl font-black tracking-tight text-text">
                    {pageLabel}
                  </h1>
                </div>
              </div>
              <p className="mt-3 text-sm font-medium text-text-muted">
                Accurate time. Verified location.
              </p>
            </div>

            {children}
          </section>
        </div>
      </div>
    </div>
  );
}
