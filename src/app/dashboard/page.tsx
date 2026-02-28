"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, MapPin, User } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard from "@/components/charts/ChartCard";
import { useAppStore } from "@/lib/store";
import { formatElapsedFromClockIn, formatTime } from "@/lib/utils";

type DashboardSummary = {
  kpis: {
    active_now: number;
    open_shifts: number;
    hours_today: number;
    hours_week: number;
    active_sites: number;
    geofence_alerts_today: number;
  };
  charts: {
    hours_last_7_days: Array<{ date: string; hours: number }>;
    top_projects_week: Array<{ project_id: string; name: string; hours: number }>;
  };
  attention: Array<
    | {
        type: "outside_geofence";
        employee_id: string;
        employee_name: string;
        project_id: string;
        project_name: string;
        distance_m: number;
        radius_m: number;
        clock_in: string;
      }
    | {
        type: "left_site";
        employee_id: string;
        employee_name: string;
        project_id: string;
        project_name: string;
        occurred_at: string;
      }
    | {
        type: "long_shift";
        employee_id: string;
        employee_name: string;
        project_id: string;
        project_name: string;
        hours: number;
        clock_in: string;
      }
    | {
        type: "missed_clock_out";
        employee_id: string;
        employee_name: string;
        project_id: string;
        project_name: string;
        clock_in: string;
      }
  >;
};

function LiveDot() {
  return <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse-dot" />;
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
    <div className="bg-card rounded-xl border border-border p-2.5">
      <div className="bg-bg rounded-lg px-2.5 py-2 text-center">
        <p
          className="text-[20px] md:text-[22px] font-extrabold tracking-tight leading-tight"
          style={{ color: color || "var(--color-text)" }}
        >
          {value}
        </p>
        <p className="text-[9px] font-semibold text-text-muted uppercase tracking-widest mt-0.5">
          {label}
        </p>
      </div>
    </div>
  );
}

function formatAxisDate(dateValue: string): string {
  const parsed = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function attentionLabel(item: DashboardSummary["attention"][number]): string {
  if (item.type === "outside_geofence") return "Outside Geofence";
  if (item.type === "left_site") return "Left Site";
  if (item.type === "long_shift") return "Long Shift";
  return "Missed Clock-Out";
}

function attentionDescription(item: DashboardSummary["attention"][number]): string {
  if (item.type === "outside_geofence") {
    return `${item.employee_name} is ${item.distance_m}m from ${item.project_name} (radius ${item.radius_m}m).`;
  }
  if (item.type === "left_site") {
    return `${item.employee_name} exited ${item.project_name} at ${formatDateTime(item.occurred_at)}.`;
  }
  if (item.type === "long_shift") {
    return `${item.employee_name} has been on ${item.project_name} for ${item.hours.toFixed(1)}h.`;
  }
  return `${item.employee_name} clocked into ${item.project_name} on ${formatDateTime(
    item.clock_in
  )} and is still open.`;
}

export default function DashboardPage() {
  const { profile, projects, activeEntry, activeSessions } = useAppStore();
  const isManagerOrAdmin = profile?.role === "manager" || profile?.role === "admin";
  const myActiveEntry =
    isManagerOrAdmin && activeEntry && activeEntry.employee_id === profile?.id
      ? activeEntry
      : null;
  const myActiveProject = myActiveEntry
    ? projects.find((project) => project.id === myActiveEntry.project_id)
    : null;

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!isManagerOrAdmin) return;

    const controller = new AbortController();
    const loadSummary = async () => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const response = await fetch("/api/dashboard/summary", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | DashboardSummary
          | { error?: string }
          | null;

        if (!response.ok || !payload || !("kpis" in payload)) {
          setSummary(null);
          setSummaryError(
            (payload as { error?: string } | null)?.error ??
              `Failed to load dashboard summary (HTTP ${response.status}).`
          );
          return;
        }

        setSummary(payload as DashboardSummary);
      } catch {
        if (!controller.signal.aborted) {
          setSummaryError("Unable to load dashboard summary.");
          setSummary(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSummaryLoading(false);
        }
      }
    };

    void loadSummary();
    return () => controller.abort();
  }, [isManagerOrAdmin]);

  const chartHours = useMemo(
    () => summary?.charts.hours_last_7_days ?? [],
    [summary?.charts.hours_last_7_days]
  );
  const chartProjects = useMemo(
    () =>
      (summary?.charts.top_projects_week ?? []).map((row) => ({
        ...row,
        short_name: row.name.length > 22 ? `${row.name.slice(0, 22)}...` : row.name,
      })),
    [summary?.charts.top_projects_week]
  );

  return (
    <div className="animate-fade-in space-y-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Dashboard</h1>

      {myActiveEntry && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-green">Clocked In</p>
              <p className="text-xs text-text-muted mt-1">
                {myActiveProject
                  ? `${myActiveProject.name} since ${formatTime(myActiveEntry.clock_in)}`
                  : `Since ${formatTime(myActiveEntry.clock_in)}`}
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
      )}

      {summaryError ? (
        <div className="bg-card rounded-2xl border border-red-border p-4 text-sm text-red">
          {summaryError}
        </div>
      ) : null}

      {summaryLoading && !summary ? (
        <div className="bg-card rounded-2xl border border-border p-8 text-center text-sm text-text-muted">
          Loading dashboard metrics...
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
            <StatCard
              value={summary.kpis.active_now}
              label="Active Now"
              color="var(--color-green)"
            />
            <StatCard value={summary.kpis.open_shifts} label="Open Shifts" />
            <StatCard value={`${summary.kpis.hours_today.toFixed(1)}h`} label="Hours Today" />
            <StatCard
              value={`${summary.kpis.hours_week.toFixed(1)}h`}
              label="Hours This Week"
              color="var(--color-accent)"
            />
            <StatCard value={summary.kpis.active_sites} label="Active Sites" />
            <StatCard
              value={summary.kpis.geofence_alerts_today}
              label="Geofence Alerts"
              color="var(--color-red)"
            />
          </div>
        </>
      ) : null}

      <div>
        <h2 className="text-base font-bold mb-3">Live on Site</h2>
        {activeSessions.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border p-8 text-center">
            <p className="text-[13px] text-text-dim">No one is currently clocked in</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {activeSessions.slice(0, 10).map((session, i) => (
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
                        {session.project_name} · Since {formatTime(session.clock_in)} ·{" "}
                        {formatElapsedFromClockIn(session.clock_in)}
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

      {summary ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard title="Hours by Day" subtitle="Last 7 days">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartHours}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
                    tickFormatter={formatAxisDate}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tickLine={{ stroke: "var(--color-border)" }}
                  />
                  <YAxis
                    tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tickLine={{ stroke: "var(--color-border)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.06)" }}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      color: "var(--color-text)",
                    }}
                  />
                  <Bar dataKey="hours" fill="var(--color-accent)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top Projects" subtitle="This week by total hours">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartProjects} layout="vertical" margin={{ left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    type="number"
                    tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tickLine={{ stroke: "var(--color-border)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="short_name"
                    width={130}
                    tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tickLine={{ stroke: "var(--color-border)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.06)" }}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      color: "var(--color-text)",
                    }}
                  />
                  <Bar dataKey="hours" fill="var(--color-green)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="bg-card rounded-2xl border border-border p-4 lg:p-5">
            <h2 className="text-base font-bold mb-3">Needs Attention</h2>
            {summary.attention.length === 0 ? (
              <p className="text-sm text-text-muted">No issues need attention right now.</p>
            ) : (
              <div className="space-y-2.5">
                {summary.attention.map((item, index) => (
                  <div
                    key={`${item.type}-${item.employee_id}-${item.project_id}-${index}`}
                    className="rounded-xl border border-border bg-bg p-3.5 flex items-start gap-3"
                  >
                    <AlertTriangle size={16} className="text-red mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-bold">{attentionLabel(item)}</p>
                      <p className="text-xs text-text-muted mt-1">{attentionDescription(item)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
