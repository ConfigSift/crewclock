"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { HardHat, Download } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import HeroSection from "@/components/HeroSection";

// ─── Data ─────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "How it works", href: "#how" },
  { label: "Features", href: "#features" },
  { label: "Reports", href: "#reports" },
  { label: "Pricing", href: "#pricing" },
];

const MONTHLY_FEATURES = [
  "Unlimited employees",
  "GPS geofenced clock-in",
  "Live dashboard",
  "Reports + CSV export",
  "Assisted clock-out",
];

type FilterPeriod = "week" | "month" | "year";

const REPORT_DATA: Record<
  FilterPeriod,
  { rows: { name: string; hours: string }[]; total: string }
> = {
  week: {
    rows: [
      { name: "Maria Santos", hours: "32.5h" },
      { name: "Jake Thompson", hours: "28.0h" },
      { name: "Luis Reyes", hours: "35.2h" },
    ],
    total: "95.7h",
  },
  month: {
    rows: [
      { name: "Maria Santos", hours: "142.0h" },
      { name: "Jake Thompson", hours: "118.5h" },
      { name: "Luis Reyes", hours: "155.8h" },
    ],
    total: "416.3h",
  },
  year: {
    rows: [
      { name: "Maria Santos", hours: "1,680h" },
      { name: "Jake Thompson", hours: "1,420h" },
      { name: "Luis Reyes", hours: "1,812h" },
    ],
    total: "4,912h",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function smoothScroll(e: React.MouseEvent, href: string) {
  e.preventDefault();
  const id = href.replace("#", "");
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

// ─── Feature row visual components ────────────────────────────────────────────

function VisualGeofence() {
  return (
    <div className="space-y-2.5">
      {[
        { name: "Riverside Condos", radius: "300m", address: "1421 Riverside Dr" },
        { name: "Oak Street Office", radius: "200m", address: "340 Oak Street" },
      ].map(({ name, radius, address }) => (
        <div
          key={name}
          className="bg-card border border-border rounded-xl p-3.5 flex items-center gap-3"
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(52, 199, 89, 0.1)" }}
          >
            <span className="text-[14px]">📍</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-text leading-tight">{name}</p>
            <p className="text-[11px] text-text-muted mt-0.5">{address}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className="text-[10px] font-bold text-green px-2 py-0.5 rounded-full"
              style={{ background: "rgba(52, 199, 89, 0.12)" }}
            >
              In geofence ✅
            </span>
            <span
              className="text-[10px] font-bold text-accent px-2 py-0.5 rounded-full"
              style={{ background: "rgba(229, 160, 36, 0.12)" }}
            >
              {radius} radius
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function VisualLiveOnSite() {
  return (
    <div className="space-y-2">
      {[
        { initials: "MS", name: "Maria Santos", duration: "3h 12m", site: "Riverside Condos" },
        { initials: "JT", name: "Jake Thompson", duration: "2h 45m", site: "Oak Street Office" },
        { initials: "LR", name: "Luis Reyes", duration: "1h 20m", site: "Maple Ridge Plaza" },
      ].map(({ initials, name, duration, site }) => (
        <div
          key={name}
          className="bg-card border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-3"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-extrabold text-bg shrink-0"
            style={{ background: "rgba(52, 199, 89, 0.75)" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-text leading-tight">{name}</p>
            <p className="text-[11px] text-text-muted truncate">{site}</p>
          </div>
          <span
            className="text-[10px] font-bold text-green px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "rgba(52, 199, 89, 0.12)" }}
          >
            Active · {duration}
          </span>
        </div>
      ))}
    </div>
  );
}

function VisualJobsites() {
  return (
    <div className="space-y-2.5">
      {[
        { name: "Riverside Condos", radius: "300m", address: "1421 Riverside Dr" },
        { name: "Oak Street Office", radius: "200m", address: "340 Oak Street" },
        { name: "Maple Ridge Plaza", radius: "250m", address: "900 Maple Ridge Blvd" },
      ].map(({ name, radius, address }) => (
        <div
          key={name}
          className="bg-card border border-border rounded-xl p-3.5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-text leading-tight">{name}</p>
            <p className="text-[11px] text-text-muted mt-0.5">{address}</p>
          </div>
          <span
            className="text-[11px] font-bold text-accent px-2.5 py-1 rounded-full shrink-0"
            style={{ background: "rgba(229, 160, 36, 0.12)" }}
          >
            {radius}
          </span>
        </div>
      ))}
    </div>
  );
}

function VisualCrew() {
  return (
    <div className="space-y-2">
      {[
        { initials: "MS", name: "Maria Santos", role: "Employee", isGreen: true },
        { initials: "JT", name: "Jake Thompson", role: "Manager", isGreen: false },
        { initials: "LR", name: "Luis Reyes", role: "Admin", isGreen: false },
      ].map(({ initials, name, role, isGreen }) => (
        <div
          key={name}
          className="bg-card border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-3"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-extrabold text-bg shrink-0"
            style={{
              background: isGreen
                ? "rgba(52, 199, 89, 0.75)"
                : "rgba(229, 160, 36, 0.75)",
            }}
          >
            {initials}
          </div>
          <p className="flex-1 text-[13px] font-bold text-text">{name}</p>
          <span
            className="text-[10px] font-bold px-2.5 py-0.5 rounded-full shrink-0"
            style={
              isGreen
                ? { background: "rgba(52, 199, 89, 0.12)", color: "var(--color-green)" }
                : { background: "rgba(229, 160, 36, 0.12)", color: "var(--color-accent)" }
            }
          >
            {role}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Feature row ──────────────────────────────────────────────────────────────

function FeatureRow({
  tag,
  title,
  body,
  bullets,
  visual,
  reverse = false,
}: {
  tag: string;
  title: string;
  body: string;
  bullets?: string[];
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      {/* Copy — on mobile always first; on desktop: natural for non-reversed, second for reversed */}
      <div className={reverse ? "order-1 lg:order-2" : ""}>
        <p
          className="text-[11px] font-bold uppercase text-accent mb-3"
          style={{ letterSpacing: "1.5px" }}
        >
          {tag}
        </p>
        <h2
          className="text-[28px] font-bold text-text leading-[1.15] mb-4"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {title}
        </h2>
        <p className="text-[14px] text-text-muted leading-relaxed mb-5">
          {body}
        </p>
        {bullets && (
          <ul className="space-y-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-[13px] text-text">
                <span
                  className="shrink-0 text-[13px] font-bold leading-[1.4]"
                  style={{ color: "var(--color-accent)" }}
                >
                  ✓
                </span>
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Visual — on mobile always second; on desktop: natural for non-reversed, first for reversed */}
      <div className={reverse ? "order-2 lg:order-1" : ""}>
        <div
          className="bg-surface border border-border rounded-xl p-5"
          style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
        >
          {visual}
        </div>
      </div>
    </div>
  );
}

// ─── Report card ──────────────────────────────────────────────────────────────

function ReportCard() {
  const [activeFilter, setActiveFilter] = useState<FilterPeriod>("week");
  const [fading, setFading] = useState(false);

  const handleFilter = (period: FilterPeriod) => {
    if (period === activeFilter) return;
    setFading(true);
    setTimeout(() => {
      setActiveFilter(period);
      setFading(false);
    }, 150);
  };

  const { rows, total } = REPORT_DATA[activeFilter];

  return (
    <div
      className="bg-card border border-border rounded-2xl overflow-hidden"
      style={{ boxShadow: "0 8px 48px rgba(0,0,0,0.18)" }}
    >
      {/* Filter pills */}
      <div className="border-b border-border px-5 py-3 flex items-center gap-1.5">
        {(["week", "month", "year"] as FilterPeriod[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handleFilter(p)}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-bold capitalize transition-all"
            style={
              activeFilter === p
                ? { background: "rgba(229, 160, 36, 0.15)", color: "var(--color-accent)" }
                : { background: "transparent", color: "var(--color-text-muted)" }
            }
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Header row */}
      <div className="grid grid-cols-2 px-5 py-2.5 bg-surface">
        <p className="text-[11px] font-bold text-text-dim uppercase tracking-wider">Employee</p>
        <p className="text-[11px] font-bold text-text-dim uppercase tracking-wider text-right">Hours</p>
      </div>

      {/* Data rows */}
      <div
        className="divide-y divide-border"
        style={{ opacity: fading ? 0 : 1, transition: "opacity 0.15s ease" }}
      >
        {rows.map(({ name, hours }) => (
          <div key={name} className="grid grid-cols-2 px-5 py-3 items-center">
            <p className="text-[12px] font-semibold text-text">{name}</p>
            <p className="text-[12px] font-extrabold text-accent text-right">{hours}</p>
          </div>
        ))}
      </div>

      {/* Total row */}
      <div
        className="grid grid-cols-2 px-5 py-3 items-center"
        style={{
          borderTop: "2px solid var(--color-border)",
          opacity: fading ? 0 : 1,
          transition: "opacity 0.15s ease",
        }}
      >
        <p className="text-[12px] font-bold text-text-muted">Total</p>
        <p className="text-[14px] font-extrabold text-accent text-right">{total}</p>
      </div>
    </div>
  );
}

// ─── Pricing card ─────────────────────────────────────────────────────────────

function PricingCard({ period }: { period: "monthly" | "annual" }) {
  const [fading, setFading] = useState(false);
  const [displayed, setDisplayed] = useState<"monthly" | "annual">(period);

  useEffect(() => {
    if (period === displayed) return;
    setFading(true);
    const t = setTimeout(() => {
      setDisplayed(period);
      setFading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [period, displayed]);

  return (
    <div
      className="relative p-[2.5px] rounded-2xl mx-auto"
      style={{
        maxWidth: 380,
        background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))",
      }}
    >
      {/* Ribbon */}
      <div
        className="absolute top-3 -right-1.5 px-[10px] py-[3px] rounded-l-md text-[10px] font-bold text-white"
        style={{
          background: "var(--color-accent)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        }}
      >
        $1 first month
      </div>

      {/* Inner card */}
      <div className="bg-card rounded-[14px] p-7 flex flex-col items-center text-center">
        {/* Price area — fades on period switch */}
        <div style={{ opacity: fading ? 0 : 1, transition: "opacity 0.15s ease" }}>
          <p className="text-[36px] font-black text-text leading-none">
            {displayed === "monthly" ? "$19.99" : "$199"}
          </p>
          <p className="text-[13px] text-text-muted mt-1.5">
            {displayed === "monthly" ? "per month" : "per year"}
          </p>
          {displayed === "annual" && (
            <p className="text-[12px] font-bold text-green mt-1">Save $40/year</p>
          )}
        </div>

        <div className="mb-4" />

        {/* Feature list */}
        <ul className="w-full text-left mb-6 divide-y divide-border">
          {MONTHLY_FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-2.5 py-2.5 text-[13px] text-text">
              <span className="text-accent font-bold shrink-0">✓</span>
              {f}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <a
          href="/signup"
          className="block w-full text-center py-3 rounded-xl bg-gradient-to-br from-accent to-accent-dark text-[#111318] text-[14px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_8px_32px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
        >
          Start for $1
        </a>

        {/* Note */}
        <p className="text-[11px] text-text-dim mt-3">Cancel anytime.</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [pricingPeriod, setPricingPeriod] = useState<"monthly" | "annual">("monthly");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-bg" style={{ transition: "background 0.3s, color 0.3s" }}>

      {/* ── NAV ───────────────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
        style={{
          borderBottom: scrolled ? "1px solid var(--color-border)" : "1px solid transparent",
          background: scrolled
            ? "color-mix(in srgb, var(--color-bg) 85%, transparent)"
            : "transparent",
          backdropFilter: scrolled ? "blur(16px)" : "none",
          WebkitBackdropFilter: scrolled ? "blur(16px)" : "none",
        }}
      >
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between gap-4">
          <Link href="/" className="shrink-0">
            <div
              className="w-8 h-8 bg-gradient-to-br from-accent to-accent-dark rounded-[9px] flex items-center justify-center"
              style={{ boxShadow: "0 2px 10px var(--color-accent-glow)" }}
            >
              <HardHat size={17} className="text-bg" />
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                onClick={(e) => smoothScroll(e, href)}
                className="text-[13px] font-semibold text-text-muted hover:text-text transition-colors"
              >
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="inline-flex items-center px-3.5 py-[7px] rounded-lg border border-border text-text text-[13px] font-semibold hover:border-accent hover:text-accent transition-colors"
            >
              Log In
            </Link>
            <a
              href="#pricing"
              onClick={(e) => smoothScroll(e, "#pricing")}
              className="inline-flex items-center px-3.5 py-[7px] rounded-lg bg-gradient-to-br from-accent to-accent-dark text-[#111318] text-[13px] font-extrabold shadow-[0_2px_12px_var(--color-accent-glow)] hover:shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-px transition-all"
            >
              Start for $1
            </a>
          </div>
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <HeroSection />

      {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
      <section id="how" className="py-[40px] px-4 sm:px-6 border-t border-border">
        <div className="max-w-[1080px] mx-auto">
          <h2
            className="text-[30px] font-bold text-text text-center mb-6 leading-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Verified time in 3 steps.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[
              {
                n: "1",
                title: "Add jobsites",
                desc: "Set an address and radius once.",
              },
              {
                n: "2",
                title: "Invite your crew",
                desc: "Unlimited employees included.",
              },
              {
                n: "3",
                title: "Track & export",
                desc: "By employee and by jobsite.",
              },
            ].map(({ n, title, desc }) => (
              <div
                key={n}
                className="bg-surface border border-border rounded-xl p-5 text-center hover:-translate-y-0.5 transition-all duration-200"
                style={{
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "0 4px 24px rgba(0,0,0,0.12)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "0 1px 4px rgba(0,0,0,0.06)";
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center mx-auto mb-4 text-[15px] font-bold text-accent"
                  style={{ background: "rgba(229, 160, 36, 0.15)" }}
                >
                  {n}
                </div>
                <h3 className="text-[16px] font-bold text-text mb-1.5">{title}</h3>
                <p className="text-[13px] text-text-muted leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────── */}
      <section id="features" className="py-[40px] px-4 sm:px-6 border-t border-border">
        <div className="max-w-[1080px] mx-auto space-y-12">

          {/* Row 1 — Verified Clock-Ins (copy left, visual right) */}
          <FeatureRow
            tag="CORE"
            title="Verified clock-ins, without extra steps."
            body="No manual location checks. No honor system. CrewClock handles it."
            bullets={[
              "Auto-detects the jobsite when an employee arrives",
              "Clock In only inside the geofence",
              "Clear on-site status for managers and payroll",
            ]}
            visual={<VisualGeofence />}
          />

          {/* Row 2 — Live on Site (copy right, visual left) */}
          <FeatureRow
            tag="MANAGER"
            title="See who's on site—right now."
            body="Live status by jobsite, with the tools to keep timesheets clean—even when someone forgets to clock out."
            bullets={[
              "Real-time active worker feed",
              "Assisted clock-out for managers",
              "Active count per jobsite",
            ]}
            visual={<VisualLiveOnSite />}
            reverse
          />

          {/* Row 3 — Jobsites (copy left, visual right) */}
          <FeatureRow
            tag="JOBSITES"
            title="Jobsites with geofences built in."
            body="Set a radius per jobsite so clock-ins happen where the work happens."
            visual={<VisualJobsites />}
          />

          {/* Row 4 — Crew (copy right, visual left) */}
          <FeatureRow
            tag="CREW"
            title="Unlimited employees. Clear roles."
            body="Add staff, assign roles, and manage access in one place."
            visual={<VisualCrew />}
            reverse
          />
        </div>
      </section>

      {/* ── REPORTS ───────────────────────────────────────────────────── */}
      <section id="reports" className="py-[40px] px-4 sm:px-6 border-t border-border">
        <div className="max-w-[1080px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <p
              className="text-[11px] font-bold uppercase text-accent mb-3"
              style={{ letterSpacing: "1.5px" }}
            >
              Reports
            </p>
            <h2
              className="text-[28px] font-bold text-text leading-[1.15] mb-4"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Hours by employee. Hours by jobsite.
            </h2>
            <p className="text-[14px] text-text-muted leading-relaxed mb-6">
              Filter by week, month, or year. Export to CSV and hand it straight
              to payroll. No manual timesheets, no spreadsheet gymnastics.
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-[13px] font-semibold text-text-muted hover:text-text hover:border-accent transition-colors"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>

          {/* Visual */}
          <div>
            <ReportCard />
          </div>
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────────────────────── */}
      <section
        id="pricing"
        className="py-[40px] px-4 sm:px-6 border-t border-border"
        style={{ background: "var(--color-surface)" }}
      >
        <div className="max-w-[1100px] mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h2
              className="text-[30px] font-bold text-text leading-tight mb-3"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Simple pricing. Unlimited employees.
            </h2>
            <p className="text-[15px] text-text-muted">
              Start for $1. Upgrade anytime.
            </p>
          </div>

          {/* Monthly / Annual toggle */}
          <div className="flex items-center justify-center mb-8">
            <div
              className="flex rounded-xl border border-border overflow-hidden"
              style={{ background: "var(--color-card)" }}
            >
              {(["monthly", "annual"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPricingPeriod(p)}
                  className="px-5 py-2 text-[13px] font-bold capitalize transition-all"
                  style={
                    pricingPeriod === p
                      ? { background: "var(--color-accent)", color: "white" }
                      : { background: "transparent", color: "var(--color-text-muted)" }
                  }
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Single card */}
          <PricingCard period={pricingPeriod} />
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────────────── */}
      <section className="py-[40px] px-4 sm:px-6 border-t border-border">
        <div className="max-w-[600px] mx-auto text-center">
          <h2
            className="text-[32px] font-bold text-text leading-tight mb-8"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Ready to verify time on site?
          </h2>
          <div className="flex items-center justify-center gap-[10px] flex-wrap mb-4">
            <a
              href="/signup"
              className="inline-flex items-center px-6 py-3.5 rounded-xl bg-gradient-to-br from-accent to-accent-dark text-[#111318] text-[15px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_8px_32px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
            >
              Start for $1
            </a>
            <Link
              href="/login"
              className="inline-flex items-center px-6 py-3.5 rounded-xl border border-border text-text text-[15px] font-semibold hover:border-accent hover:text-accent transition-colors"
            >
              Log In
            </Link>
          </div>
          <p className="text-[12px] text-text-dim">Unlimited employees · Cancel anytime</p>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-[18px] px-4 sm:px-6 text-center">
        <p className="text-[12px] text-text-dim">
          © 2026 CrewClock · GPS-verified time tracking for field teams
        </p>
      </footer>
    </div>
  );
}
