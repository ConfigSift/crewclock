"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  formatHours,
  calcTotalSeconds,
  isInPeriod,
  type Period,
} from "@/lib/utils";

export default function ReportsPage() {
  const { projects, timeEntries, employees } = useAppStore();
  const [period, setPeriod] = useState<Period>("week");

  const activeProjects = projects.filter((p) => p.status === "active");

  const tabs: { key: Period; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
  ];

  return (
    <div className="animate-fade-in">
      <h1 className="text-[22px] font-extrabold tracking-tight mb-5">
        Project Hours
      </h1>

      {/* Period Tabs */}
      <div className="flex gap-1 bg-bg p-1 rounded-xl mb-5 max-w-[300px]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setPeriod(t.key)}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
              period === t.key ? "bg-card text-accent" : "text-text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Project Breakdown */}
      <div className="space-y-3.5">
        {activeProjects.map((project, i) => {
          const projEntries = timeEntries.filter(
            (e) => e.project_id === project.id
          );
          const totalSec = calcTotalSeconds(projEntries, period);
          const filteredEntries = projEntries.filter((e) =>
            isInPeriod(e.clock_in, period)
          );

          // Group by worker
          const workerHours: Record<string, { name: string; seconds: number }> =
            {};
          filteredEntries.forEach((entry) => {
            const emp = employees.find((e) => e.id === entry.employee_id);
            const name = emp
              ? `${emp.first_name} ${emp.last_name}`
              : entry.employee_id;
            const dur =
              entry.duration_seconds ||
              (Date.now() - new Date(entry.clock_in).getTime()) / 1000;
            if (!workerHours[name]) {
              workerHours[name] = { name, seconds: 0 };
            }
            workerHours[name].seconds += dur;
          });

          const sortedWorkers = Object.values(workerHours).sort(
            (a, b) => b.seconds - a.seconds
          );

          return (
            <div
              key={project.id}
              className="bg-card rounded-2xl border border-border p-5 animate-fade-in hover:border-border-light transition-all"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              {/* Header */}
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-base font-bold">{project.name}</h3>
                  <p className="text-xs text-text-muted">{project.address}</p>
                </div>
                <p className="text-2xl font-extrabold text-accent">
                  {formatHours(totalSec)}h
                </p>
              </div>

              {/* Worker Breakdown */}
              {sortedWorkers.length > 0 ? (
                <div className="bg-bg rounded-xl p-3">
                  <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
                    Worker Breakdown
                  </p>
                  {sortedWorkers.map((worker) => {
                    const pct =
                      totalSec > 0 ? (worker.seconds / totalSec) * 100 : 0;
                    return (
                      <div key={worker.name} className="mb-2.5 last:mb-0">
                        <div className="flex justify-between mb-1">
                          <span className="text-[13px] font-semibold">
                            {worker.name}
                          </span>
                          <span className="text-[13px] font-bold text-accent">
                            {formatHours(worker.seconds)}h
                          </span>
                        </div>
                        <div className="h-1 bg-card rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-[width] duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[13px] text-text-dim text-center py-2">
                  No entries this {period}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
