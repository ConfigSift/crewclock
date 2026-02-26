"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { HardHat, ChevronRight, X } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type SimChip = "away" | "near" | "on-site";
type PhoneState = "away" | "verified" | "active";

export type Worker = {
  name: string;
  initials: string;
  site: string;
  time: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getCurrentTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Phone state panels ───────────────────────────────────────────────────────

function PhoneAwayPanel() {
  return (
    <>
      <p className="text-[11px] font-bold mb-2" style={{ color: "var(--color-red)" }}>
        ⛔ Not on site yet
      </p>

      <div className="bg-card border border-border rounded-lg p-3 mb-2">
        <p className="text-[11px] font-semibold text-text">
          No jobsite detected nearby
        </p>
      </div>

      <p className="text-[10px] text-text-dim mb-3 leading-relaxed">
        Clock In unlocks when you arrive at a jobsite
      </p>

      <button
        type="button"
        disabled
        className="w-full py-2.5 rounded-lg text-[12px] font-bold cursor-not-allowed"
        style={{
          background: "var(--color-border)",
          color: "var(--color-text-dim)",
          opacity: 0.6,
        }}
      >
        Clock In
      </button>
    </>
  );
}

function PhoneVerifiedPanel({ onClockIn }: { onClockIn: () => void }) {
  return (
    <>
      <p className="text-[11px] font-bold text-green mb-2">
        On-site verified ✅
      </p>

      <div
        className="rounded-lg p-3 mb-2"
        style={{
          background: "rgba(52, 199, 89, 0.08)",
          border: "1px solid rgba(52, 199, 89, 0.25)",
        }}
      >
        <p className="text-[11px] font-semibold text-text">
          Jobsite detected automatically
        </p>
      </div>

      <span
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-green mb-3"
        style={{ background: "rgba(52, 199, 89, 0.12)" }}
      >
        📍 In geofence
      </span>

      <button
        type="button"
        onClick={onClockIn}
        className="w-full py-2.5 rounded-lg text-[12px] font-extrabold bg-gradient-to-br from-accent to-accent-dark text-bg shadow-[0_2px_12px_var(--color-accent-glow)] hover:shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-px transition-all"
      >
        Clock In
      </button>
    </>
  );
}

function PhoneActivePanel({
  timerSeconds,
  startedAt,
  onClockOut,
}: {
  timerSeconds: number;
  startedAt: string;
  onClockOut: () => void;
}) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-bold text-green mb-0.5">🟢 Active</p>
      <p className="text-[10px] text-text-muted mb-2">Currently clocked in</p>

      <p
        className="text-[32px] font-bold text-accent mb-0.5"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {formatHMS(timerSeconds)}
      </p>

      <p className="text-[10px] text-text-dim mb-3">Started at {startedAt}</p>

      <button
        type="button"
        onClick={onClockOut}
        className="w-full py-2.5 rounded-lg text-[12px] font-extrabold text-white hover:-translate-y-px transition-all"
        style={{ background: "var(--color-red)" }}
      >
        Clock Out
      </button>
    </div>
  );
}

// ─── Phone mockup ─────────────────────────────────────────────────────────────

function PhoneMockup({ simChip }: { simChip: SimChip }) {
  const [phoneState, setPhoneState] = useState<PhoneState>("away");
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (simChip === "on-site") {
      setPhoneState((prev) => (prev === "active" ? "active" : "verified"));
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setTimerSeconds(0);
      setPhoneState("away");
    }
  }, [simChip]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleClockIn = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setStartedAt(getCurrentTime());
    setTimerSeconds(0);
    setPhoneState("active");
    timerRef.current = setInterval(() => {
      setTimerSeconds((s) => s + 1);
    }, 1000);
  }, []);

  const handleClockOut = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setTimerSeconds(0);
    setPhoneState("verified");
  }, []);

  return (
    /* phone-device: thin-bezel navy frame, no side buttons */
    <div>
      {/* phone-frame */}
      <div
        style={{
          background: "#1B2A3B",
          borderRadius: 44,
          padding: 2,
          border: "1.5px solid #2A3D52",
          boxShadow: "0 20px 60px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)",
        }}
      >
        {/* phone-screen */}
        <div
          style={{
            background: "var(--color-surface)",
            borderRadius: 42,
            overflow: "hidden",
          }}
        >
          {/* Status bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 24px 0",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-text)",
                fontFamily: "var(--font-sans)",
              }}
            >
              9:41
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {/* Signal bars */}
              <svg width="14" height="9" viewBox="0 0 14 9" fill="none" aria-hidden="true">
                <rect x="0"    y="6" width="2.5" height="3" rx="0.5" fill="var(--color-text)" />
                <rect x="3.8"  y="4" width="2.5" height="5" rx="0.5" fill="var(--color-text)" />
                <rect x="7.5"  y="2" width="2.5" height="7" rx="0.5" fill="var(--color-text)" />
                <rect x="11.2" y="0" width="2.5" height="9" rx="0.5" fill="var(--color-text)" />
              </svg>
              {/* Battery */}
              <svg width="20" height="10" viewBox="0 0 20 10" fill="none" aria-hidden="true">
                <rect x="0.5" y="0.5" width="16" height="9" rx="2.5" stroke="var(--color-text)" strokeOpacity="0.4" />
                <rect x="2" y="2" width="11.5" height="6" rx="1.5" fill="var(--color-text)" />
                <path
                  d="M17.5 3.3 C18.3 3.3 18.9 4.1 18.9 5 C18.9 5.9 18.3 6.7 17.5 6.7"
                  stroke="var(--color-text)"
                  strokeOpacity="0.55"
                  strokeWidth="1"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </div>
          </div>

          {/* Dynamic Island */}
          <div
            style={{
              position: "relative",
              width: 64,
              height: 20,
              background: "#000",
              borderRadius: 14,
              margin: "3px auto 0",
            }}
          >
            {/* Camera lens */}
            <div
              style={{
                position: "absolute",
                right: 5,
                top: "50%",
                transform: "translateY(-50%)",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "radial-gradient(circle, #1a3a5c 30%, #0d1f30 70%)",
                border: "1px solid #0a0a0a",
              }}
            />
          </div>

          {/* Gold app bar */}
          <div
            className="bg-gradient-to-br from-accent to-accent-dark px-3 py-2.5 flex items-center gap-1.5"
            style={{ marginTop: 8 }}
          >
            <HardHat size={14} className="text-bg" />
            <span className="text-[12px] font-extrabold text-bg">CrewClock</span>
            <span
              className="ml-auto text-[8px] font-bold px-1.5 py-[2px] rounded text-white"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              EMP
            </span>
          </div>

          {/* Job label */}
          <div className="px-4 pt-3 pb-0">
            <p
              className="uppercase mb-0.5"
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                letterSpacing: "0.8px",
              }}
            >
              Current Job
            </p>
            <p className="text-text" style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
              Riverside Condos
            </p>
          </div>

          {/* State body — key forces remount → re-triggers fade-in */}
          <div
            key={phoneState}
            className="px-4 pb-3 animate-fade-in"
            style={{ minHeight: 240 }}
          >
            {phoneState === "away" && <PhoneAwayPanel />}
            {phoneState === "verified" && (
              <PhoneVerifiedPanel onClockIn={handleClockIn} />
            )}
            {phoneState === "active" && (
              <PhoneActivePanel
                timerSeconds={timerSeconds}
                startedAt={startedAt}
                onClockOut={handleClockOut}
              />
            )}
          </div>

          {/* Home indicator */}
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
            <div
              style={{
                width: 120,
                height: 4,
                background: "var(--color-text)",
                opacity: 0.15,
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tablet mockup ────────────────────────────────────────────────────────────

function TabletMockup({
  workers,
  onWorkerClick,
  isDark,
}: {
  workers: Worker[];
  onWorkerClick: (worker: Worker) => void;
  isDark: boolean;
}) {
  return (
    /* tablet-device: outer positioning wrapper — width controlled by parent */
    <div>
      {/* tablet-frame: thin-bezel dark navy */}
      <div
        style={{
          background: isDark ? "#0F1A28" : "#1B2A3B",
          borderRadius: 24,
          padding: 3,
          border: isDark ? "2px solid #1A2A3B" : "2px solid #2A3D52",
          transition: "background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease",
          boxShadow: [
            "0 20px 60px rgba(0,0,0,0.12)",
            "0 4px 12px rgba(0,0,0,0.06)",
            isDark ? "0 0 60px rgba(229,160,36,0.04)" : "",
          ]
            .filter(Boolean)
            .join(", "),
        }}
      >
        {/* tablet-cam: front camera dot */}
        <div
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "radial-gradient(circle, #1a2a40 40%, #0d1520 70%)",
            border: "1px solid #222",
            margin: "2px auto 2px",
          }}
        />

        {/* tablet-screen */}
        <div
          style={{
            background: "var(--color-surface)",
            borderRadius: 22,
            overflow: "hidden",
          }}
        >
          {/* Gold app bar */}
          <div className="bg-gradient-to-br from-accent to-accent-dark px-4 py-2.5 flex items-center gap-2">
            <HardHat size={15} className="text-bg" />
            <span className="text-[13px] font-extrabold text-bg">CrewClock</span>
            <span
              className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded text-bg"
              style={{ background: "rgba(17, 19, 24, 0.25)" }}
            >
              MGR
            </span>
          </div>

          {/* Body */}
          <div className="p-4">
            <p className="text-[13px] font-bold text-text mb-3">Live on Site</p>

            {/* Mini stat row — Active count derives from workers.length */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: "Active", value: String(workers.length), color: "var(--color-green)" },
                { label: "Crew", value: "8", color: "var(--color-text)" },
                { label: "Today", value: "42.5h", color: "var(--color-accent)" },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-card border border-border rounded-lg p-2 text-center"
                >
                  <p className="text-[17px] font-extrabold leading-none" style={{ color }}>
                    {value}
                  </p>
                  <p className="text-[9px] text-text-dim mt-0.5 font-semibold uppercase tracking-wide">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            {/* Worker rows */}
            <p className="text-[10px] text-text-muted font-semibold mb-2 uppercase tracking-wider">
              Currently on site
            </p>

            <div className="space-y-1.5">
              {workers.length === 0 && (
                <p className="text-[11px] text-text-dim text-center py-3">
                  No workers on site
                </p>
              )}
              {workers.map((worker) => (
                <button
                  key={worker.name}
                  type="button"
                  onClick={() => onWorkerClick(worker)}
                  className="w-full flex items-center gap-2.5 bg-card border border-border rounded-xl px-3 py-2 hover:bg-surface transition-colors text-left"
                >
                  {/* Avatar */}
                  <div
                    className="w-[22px] h-[22px] rounded-lg flex items-center justify-center shrink-0 text-[8px] font-extrabold text-bg"
                    style={{ background: "rgba(52, 199, 89, 0.75)" }}
                  >
                    {worker.initials}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-text leading-tight">
                      {worker.name}
                    </p>
                    <p className="text-[8px] text-text-muted leading-tight truncate">
                      {worker.site} · {worker.time}
                    </p>
                  </div>

                  {/* Live pulse */}
                  <div className="w-[5px] h-[5px] rounded-full bg-green animate-pulse-dot shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* tablet-home-indicator */}
          <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 4px" }}>
            <div
              style={{
                width: 80,
                height: 4,
                background: "white",
                opacity: 0.15,
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Assist Clock-Out modal ────────────────────────────────────────────────────

function AssistClockOutModal({
  worker,
  onClose,
  onConfirm,
}: {
  worker: Worker;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // Drive the card's CSS transition: false → true on mount triggers scale+fade in
  const [visible, setVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Trigger enter transition on next frame
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Move focus into modal
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Escape key closes modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={onClose}
      aria-label="Close dialog"
    >
      {/* Card */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-2xl w-full"
        style={{
          maxWidth: 340,
          padding: 28,
          boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 4px 20px rgba(0,0,0,0.2)",
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.96)",
          transition: "opacity 0.2s ease, transform 0.2s ease",
        }}
      >
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <h2
            id="modal-title"
            className="text-[17px] font-extrabold text-text leading-tight"
          >
            Assist clock-out
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors -mt-0.5 -mr-1 p-1 rounded-lg hover:bg-card"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <p className="text-[14px] text-text-muted leading-relaxed mb-6">
          This will end{" "}
          <strong className="text-text font-bold">{worker.name}</strong>
          &apos;s active time entry.
        </p>

        {/* Worker preview */}
        <div
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-6 border border-border"
          style={{ background: "rgba(52, 199, 89, 0.06)" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-extrabold text-bg"
            style={{ background: "rgba(52, 199, 89, 0.75)" }}
          >
            {worker.initials}
          </div>
          <div>
            <p className="text-[13px] font-bold text-text">{worker.name}</p>
            <p className="text-[11px] text-text-muted">{worker.site} · {worker.time}</p>
          </div>
          <div className="ml-auto w-[6px] h-[6px] rounded-full bg-green animate-pulse-dot shrink-0" />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-border text-text text-[14px] font-semibold hover:bg-card transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-[14px] font-extrabold text-white hover:-translate-y-px transition-all"
            style={{ background: "var(--color-red)" }}
          >
            Clock Out Employee
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ visible }: { visible: boolean }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed left-1/2 z-[60] px-5 py-3 rounded-lg text-[13px] font-bold text-white"
      style={{
        bottom: 96,
        background: "var(--color-green)",
        boxShadow: "0 4px 24px rgba(52, 199, 89, 0.35)",
        transform: `translateX(-50%) translateY(${visible ? 0 : 80}px)`,
        opacity: visible ? 1 : 0,
        transition: "transform 0.25s cubic-bezier(0.34, 1.2, 0.64, 1), opacity 0.2s ease",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      ✓ Clock-out recorded.
    </div>
  );
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const INITIAL_WORKERS: Worker[] = [
  { name: "Maria Santos", initials: "MS", site: "Riverside Condos", time: "3h 12m" },
  { name: "Jake Thompson", initials: "JT", site: "Oak Street Office", time: "2h 45m" },
  { name: "Luis Reyes", initials: "LR", site: "Maple Ridge Plaza", time: "1h 20m" },
];

const SIM_CHIPS: { id: SimChip; label: string }[] = [
  { id: "away", label: "Away" },
  { id: "near", label: "Near" },
  { id: "on-site", label: "On site ✅" },
];

// ─── Hero section ─────────────────────────────────────────────────────────────

export default function HeroSection() {
  const [simChip, setSimChip] = useState<SimChip>("away");

  // Workers list — lifted so modal can mutate it and tablet stat updates automatically
  const [workers, setWorkers] = useState<Worker[]>(INITIAL_WORKERS);

  // Modal state
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dark-mode detection — drives tablet frame + glow
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () =>
      setIsDark(document.documentElement.dataset.theme !== "light");
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleConfirmClockOut = useCallback(() => {
    if (!selectedWorker) return;

    // 1. Close modal
    setSelectedWorker(null);

    // 2. Remove worker from list (active count decreases automatically)
    setWorkers((prev) => prev.filter((w) => w.name !== selectedWorker.name));

    // 3. Show toast
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 2500);
  }, [selectedWorker]);

  const handleCloseModal = useCallback(() => {
    setSelectedWorker(null);
  }, []);

  return (
    <>
      <section
        className="pt-28 pb-16 px-4 sm:px-6 animate-fade-in"
        style={{
          background:
            "linear-gradient(180deg, var(--color-hero-from) 0%, var(--color-bg) 100%)",
        }}
      >
        <div className="max-w-[1100px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-8 items-center">

          {/* ── LEFT: copy ────────────────────────────────────────── */}
          <div>
            {/* Headline — serif */}
            <h1
              className="text-[42px] sm:text-[48px] font-bold text-text leading-[1.1] tracking-tight mb-5"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Clock-ins that only count on site.
            </h1>

            {/* Subhead */}
            <p
              className="text-[16px] text-text-muted leading-relaxed mb-8"
              style={{ maxWidth: 430 }}
            >
              CrewClock auto-detects the jobsite when your crew arrives. Clock
              in/out is only available inside the geofence—managers get live
              visibility and clean hour reports.
            </p>

            {/* Simulation chips */}
            <div className="flex items-center gap-2 flex-wrap mb-8">
              <span className="text-[11px] font-semibold text-text-dim shrink-0">
                Simulate:
              </span>
              {SIM_CHIPS.map(({ id, label }) => {
                const isActive = simChip === id;
                const isOnSite = id === "on-site";
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSimChip(id)}
                    className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-all"
                    style={
                      isActive
                        ? isOnSite
                          ? {
                              borderColor: "var(--color-green)",
                              background: "rgba(52, 199, 89, 0.10)",
                              color: "var(--color-green)",
                            }
                          : {
                              borderColor: "var(--color-accent)",
                              background: "rgba(229, 160, 36, 0.15)",
                              color: "var(--color-accent)",
                            }
                        : {
                            borderColor: "var(--color-border)",
                            background: "transparent",
                            color: "var(--color-text-muted)",
                          }
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <a
                href="#pricing"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-br from-accent to-accent-dark text-[#111318] text-[15px] font-extrabold shadow-[0_4px_24px_var(--color-accent-glow)] hover:shadow-[0_8px_32px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
              >
                Start for $1 <ChevronRight size={16} />
              </a>
              <Link
                href="/login"
                className="inline-flex items-center px-6 py-3.5 rounded-xl border border-border text-text text-[15px] font-semibold hover:border-accent hover:text-accent transition-colors"
              >
                Log In
              </Link>
              <a
                href="#pricing"
                className="text-[14px] font-semibold text-text-muted hover:text-text transition-colors"
              >
                View plans
              </a>
            </div>

            {/* Helper */}
            <p className="text-[12px] text-text-dim">
              Setup takes minutes. Add unlimited employees.
            </p>
          </div>

          {/* ── RIGHT: device composition ──────────────────────── */}
          {/*
            No overflow-hidden — tablet must remain fully visible.
            Mobile (<768px):  flex-col, phone on top, tablet below, centered.
            md (768px+):      fixed container, absolute layered composition.
            lg (1024px+):     wider container + tablet.
          */}
          <div className="relative flex justify-center lg:justify-end">

            {/* Warm glow behind devices — dark mode only */}
            {isDark && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse at center, rgba(229,160,36,0.04) 0%, transparent 70%)",
                }}
              />
            )}

            {/*
              Mobile:  flex-col auto-height, items centered
              md+:     fixed-size relative block, absolute children
                       Container wide enough to hold phone (200px) + tablet (300px) with ~40px overlap
              lg+:     phone 220px, tablet 320px, container 500px
            */}
            {/*
              Container sized for: phone (220px) + tablet (380px) with ~50px overlap.
              md:  phone 200px, tablet 340px → container 490px, tablet-left = 150px, overlap = 50px
              lg:  phone 220px, tablet 380px → container 550px, tablet-left = 170px, overlap = 50px
            */}
            <div className="flex flex-col items-center gap-5 w-full md:relative md:block md:shrink-0 md:w-[490px] md:h-[440px] lg:w-[550px]">

              {/* Phone — top on mobile, absolute front-left on md+ */}
              <div className="relative z-[2] w-[200px] shrink-0 md:absolute md:left-0 md:top-0 lg:w-[220px]">
                <PhoneMockup simChip={simChip} />
              </div>

              {/* Tablet — bottom on mobile, absolute back-right on md+
                  right: 0 = fully flush with container, no bleed, no clipping */}
              <div className="relative w-full max-w-[380px] md:absolute md:right-0 md:top-[10px] md:z-[1] md:w-[340px] lg:w-[380px]">
                <TabletMockup
                  workers={workers}
                  onWorkerClick={setSelectedWorker}
                  isDark={isDark}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Modal ──────────────────────────────────────────────── */}
      {selectedWorker && (
        <AssistClockOutModal
          worker={selectedWorker}
          onClose={handleCloseModal}
          onConfirm={handleConfirmClockOut}
        />
      )}

      {/* ── Toast ──────────────────────────────────────────────── */}
      <Toast visible={toastVisible} />
    </>
  );
}
