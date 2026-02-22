"use client";

import Link from "next/link";
import { User, MapPin } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { formatHours, formatTime, calcTotalSeconds } from "@/lib/utils";

function LiveDot() {
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse-dot" />
  );
}

function StatCard({
  value,
  label,
  color,
}: {
  value: string | number;
  label: string;
  color?: string;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <div className="bg-bg rounded-xl p-3.5 text-center">
        <p
          className="text-[26px] font-extrabold tracking-tight"
          style={{ color: color || "var(--color-text)" }}
        >
          {value}
        </p>
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mt-0.5">
          {label}
        </p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { employees, projects, timeEntries, activeSessions, activeEntry } =
    useAppStore();

  const weekSeconds = calcTotalSeconds(timeEntries, "week");
  const activeProjectIds = [
    ...new Set(activeSessions.map((s) => s.project_id)),
  ];
  const myActiveProject = activeEntry
    ? projects.find((project) => project.id === activeEntry.project_id)
    : null;

  return (
    <div className="animate-fade-in">
      <h1 className="text-[22px] font-extrabold tracking-tight mb-5">
        Dashboard
      </h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          value={activeSessions.length}
          label="Active Now"
          color="var(--color-green)"
        />
        <StatCard value={employees.length} label="Total Crew" />
        <StatCard
          value={`${formatHours(weekSeconds)}h`}
          label="This Week"
          color="var(--color-accent)"
        />
        <StatCard value={activeProjectIds.length} label="Active Sites" />
      </div>

      <h2 className="text-base font-bold mb-3">My Time</h2>
      <div className="bg-card rounded-2xl border border-border p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p
              className={`text-sm font-extrabold ${
                activeEntry ? "text-green" : "text-text"
              }`}
            >
              {activeEntry ? "Clocked In" : "Not Clocked In"}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {activeEntry && myActiveProject
                ? `${myActiveProject.name} since ${formatTime(activeEntry.clock_in)}`
                : "Start or end your own shift from My Time."}
            </p>
          </div>
          <Link
            href="/dashboard/clock"
            className="inline-flex items-center justify-center px-3.5 py-2 bg-gradient-to-br from-accent to-accent-dark rounded-lg text-bg text-xs font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
          >
            Open Clock
          </Link>
        </div>
      </div>

      {/* Live on Site */}
      <h2 className="text-base font-bold mb-3">Live on Site</h2>
      {activeSessions.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <p className="text-[13px] text-text-dim">
            No one is currently clocked in
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeSessions.map((session, i) => (
            <div
              key={session.entry_id}
              className="bg-card rounded-2xl border border-border p-4 animate-fade-in hover:border-border-light transition-all"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <div className="flex justify-between items-center">
                <div className="flex gap-3 items-center">
                  <div className="w-10 h-10 rounded-[10px] bg-green-dark border border-green-border flex items-center justify-center">
                    <User size={18} className="text-green" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">
                      {session.first_name} {session.last_name}
                    </p>
                    <p className="text-xs text-text-muted">
                      {session.project_name} · Since{" "}
                      {formatTime(session.clock_in)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <LiveDot />
                  <span className="hidden sm:inline text-[11px] text-text-muted">
                    <MapPin size={12} className="inline mr-1" />
                    {session.project_address}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
