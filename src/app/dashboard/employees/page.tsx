"use client";

import { useState } from "react";
import { User, MapPin, Search } from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  formatHours,
  formatTime,
  calcTotalSeconds,
  type Period,
} from "@/lib/utils";

function LiveDot() {
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse-dot" />
  );
}

export default function EmployeesPage() {
  const { employees, projects, timeEntries } = useAppStore();
  const [period, setPeriod] = useState<Period>("week");
  const [search, setSearch] = useState("");

  const filtered = employees.filter((e) =>
    `${e.first_name} ${e.last_name}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const activeEmployeeIds = new Set(
    timeEntries.filter((e) => !e.clock_out).map((e) => e.employee_id)
  );

  const tabs: { key: Period; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
  ];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <h1 className="text-[22px] font-extrabold tracking-tight">
          Employees
        </h1>
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <input
            className="pl-9 pr-3 py-2 bg-bg border border-border rounded-lg text-sm text-text w-[200px] outline-none focus:border-accent"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="bg-bg rounded-xl p-3.5 text-center">
            <p className="text-[26px] font-extrabold">{employees.length}</p>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
              Total Crew
            </p>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="bg-bg rounded-xl p-3.5 text-center">
            <p className="text-[26px] font-extrabold text-green">
              {activeEmployeeIds.size}
            </p>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
              Active Now
            </p>
          </div>
        </div>
      </div>

      {/* Employee Cards */}
      <div className="space-y-2.5">
        {filtered.map((emp, i) => {
          const empEntries = timeEntries.filter(
            (e) => e.employee_id === emp.id
          );
          const activeEntry = empEntries.find((e) => !e.clock_out);
          const totalSec = calcTotalSeconds(empEntries, period);
          const activeProject = activeEntry
            ? projects.find((p) => p.id === activeEntry.project_id)
            : null;
          const isActive = activeEmployeeIds.has(emp.id);

          return (
            <div
              key={emp.id}
              className="bg-card rounded-2xl border border-border p-4 animate-fade-in hover:border-border-light transition-all"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="flex justify-between items-start">
                <div className="flex gap-3 items-center">
                  <div
                    className={`w-[42px] h-[42px] rounded-xl flex items-center justify-center border ${
                      isActive
                        ? "bg-green-dark border-green-border"
                        : "bg-bg border-border"
                    }`}
                  >
                    <User
                      size={18}
                      className={isActive ? "text-green" : "text-text-muted"}
                    />
                  </div>
                  <div>
                    <p className="text-[15px] font-bold">
                      {emp.first_name} {emp.last_name}
                    </p>
                    <p className="text-xs text-text-muted">{emp.phone}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-extrabold text-accent">
                    {formatHours(totalSec)}h
                  </p>
                  <p className="text-[10px] text-text-muted uppercase font-semibold">
                    this {period}
                  </p>
                </div>
              </div>

              {activeEntry && activeProject && (
                <div className="mt-3 p-2.5 bg-green-dark rounded-lg border border-green-border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <LiveDot />
                    <span className="text-xs font-bold text-green">
                      CLOCKED IN
                    </span>
                    <span className="text-xs text-text-muted ml-auto">
                      Since {formatTime(activeEntry.clock_in)}
                    </span>
                  </div>
                  <p className="text-[13px] font-semibold mb-0.5">
                    {activeProject.name}
                  </p>
                  <p className="text-xs text-text-muted flex items-center gap-1">
                    <MapPin size={12} /> {activeProject.address}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
