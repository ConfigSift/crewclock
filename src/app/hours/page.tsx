"use client";

import { useState } from "react";
import WorkerLayout from "@/components/WorkerLayout";
import { useAppStore } from "@/lib/store";
import {
  formatHours,
  formatDateFull,
  formatTime,
  calcTotalSeconds,
  isInPeriod,
  type Period,
} from "@/lib/utils";

export default function HoursPage() {
  const { profile, projects, timeEntries } = useAppStore();
  const [period, setPeriod] = useState<Period>("week");

  const myEntries = timeEntries.filter(
    (e) => e.employee_id === profile?.id
  );
  const filtered = myEntries.filter((e) => isInPeriod(e.clock_in, period));
  const totalSec = calcTotalSeconds(myEntries, period);

  // Group by project
  const projectHours: Record<string, number> = {};
  filtered.forEach((e) => {
    const dur =
      e.duration_seconds ||
      (Date.now() - new Date(e.clock_in).getTime()) / 1000;
    projectHours[e.project_id] = (projectHours[e.project_id] || 0) + dur;
  });

  const tabs: { key: Period; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
  ];

  return (
    <WorkerLayout>
      <div className="p-5">
        <h1 className="text-lg font-bold mb-4">My Hours</h1>

        {/* Period Tabs */}
        <div className="flex gap-1 bg-bg p-1 rounded-xl mb-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setPeriod(t.key)}
              className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                period === t.key
                  ? "bg-card text-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Total Hours */}
        <div className="bg-gradient-to-br from-[#272218] to-card rounded-2xl border border-[#3d3520] p-7 text-center mb-4">
          <p className="text-[48px] font-extrabold text-accent tracking-tight leading-none">
            {formatHours(totalSec)}
          </p>
          <p className="text-[13px] text-text-muted font-semibold mt-1">
            Total Hours This {period.charAt(0).toUpperCase() + period.slice(1)}
          </p>
        </div>

        {/* By Project */}
        {Object.keys(projectHours).length > 0 && (
          <div className="bg-card rounded-2xl border border-border p-5 mb-4">
            <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">
              By Project
            </p>
            {Object.entries(projectHours).map(([pid, sec]) => {
              const proj = projects.find((p) => p.id === pid);
              const pct = totalSec > 0 ? (sec / totalSec) * 100 : 0;
              return (
                <div key={pid} className="mb-3.5 last:mb-0">
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-semibold">
                      {proj?.name || "Unknown"}
                    </span>
                    <span className="text-sm font-bold text-accent">
                      {formatHours(sec)}h
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-accent to-accent-dark rounded-full transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Time Entries */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">
            Time Entries
          </p>
          {filtered.filter((e) => e.clock_out).length === 0 ? (
            <p className="text-[13px] text-text-dim text-center py-4">
              No completed entries this {period}
            </p>
          ) : (
            filtered
              .filter((e) => e.clock_out)
              .map((entry) => {
                const proj = projects.find((p) => p.id === entry.project_id);
                return (
                  <div
                    key={entry.id}
                    className="flex justify-between items-center py-2.5 border-b border-border last:border-0 hover:bg-accent/[0.03] transition-colors"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {proj?.name || "Unknown"}
                      </p>
                      <p className="text-xs text-text-muted">
                        {formatDateFull(entry.clock_in)} ·{" "}
                        {formatTime(entry.clock_in)} –{" "}
                        {formatTime(entry.clock_out!)}
                      </p>
                    </div>
                    <span className="text-sm font-bold">
                      {formatHours(entry.duration_seconds || 0)}h
                    </span>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </WorkerLayout>
  );
}
