import Link from "next/link";
import type { ReactNode } from "react";
import type { ReportTabKey, ReportsData } from "@/lib/reports/queries";

type ReportsShellProps = {
  title: string;
  subtitle: string;
  activeTab: ReportTabKey;
  data: ReportsData;
  children: ReactNode;
};

const TAB_ITEMS: Array<{ key: ReportTabKey; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/dashboard/reports" },
  { key: "projects", label: "Projects", href: "/dashboard/reports/projects" },
  { key: "crew", label: "Crew", href: "/dashboard/reports/crew" },
  { key: "activity", label: "Activity", href: "/dashboard/reports/activity" },
  { key: "attendance", label: "Attendance", href: "/dashboard/reports/attendance" },
  { key: "geofence", label: "Geofence", href: "/dashboard/reports/geofence" },
];

function buildFilterQuery(data: ReportsData): URLSearchParams {
  const search = new URLSearchParams();
  search.set("range", data.filters.range);
  search.set("start", data.filters.start);
  search.set("end", data.filters.end);
  if (data.filters.project_id) {
    search.set("project_id", data.filters.project_id);
  }
  if (data.filters.worker_id) {
    search.set("worker_id", data.filters.worker_id);
  }
  return search;
}

export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ReportsShell({
  title,
  subtitle,
  activeTab,
  data,
  children,
}: ReportsShellProps) {
  const baseFilterQuery = buildFilterQuery(data);
  const baseFilterString = baseFilterQuery.toString();
  const filterAction =
    TAB_ITEMS.find((item) => item.key === activeTab)?.href ?? "/dashboard/reports";

  return (
    <div className="animate-fade-in space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
          Reports
        </p>
        <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-text">{title}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>
        <p className="mt-2 text-[12px] text-text-dim">
          Business: <span className="font-semibold text-text">{data.business.name}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          {TAB_ITEMS.map((tab) => {
            const href = baseFilterString ? `${tab.href}?${baseFilterString}` : tab.href;
            const isActive = tab.key === activeTab;
            return (
              <Link
                key={tab.key}
                href={href}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  isActive
                    ? "border-accent/50 bg-accent/[0.12] text-accent"
                    : "border-border bg-bg text-text-muted hover:text-text"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <form action={filterAction} method="get" className="grid gap-2 lg:grid-cols-6">
          <div className="lg:col-span-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Range
            </label>
            <select
              name="range"
              defaultValue={data.filters.range}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
            >
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="thisWeek">This week</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="lg:col-span-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Start
            </label>
            <input
              name="start"
              type="date"
              defaultValue={data.filters.start}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
            />
          </div>

          <div className="lg:col-span-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-text-muted">
              End
            </label>
            <input
              name="end"
              type="date"
              defaultValue={data.filters.end}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
            />
          </div>

          <div className="lg:col-span-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Project
            </label>
            <select
              name="project_id"
              defaultValue={data.filters.project_id}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
            >
              <option value="">All projects</option>
              {data.options.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Worker
            </label>
            <select
              name="worker_id"
              defaultValue={data.filters.worker_id}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
            >
              <option value="">All workers</option>
              {data.options.workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end lg:col-span-1">
            <button
              type="submit"
              className="w-full rounded-lg bg-gradient-to-br from-accent to-accent-dark px-3 py-2 text-[13px] font-extrabold text-bg shadow-[0_4px_20px_var(--color-accent-glow)] transition-all hover:-translate-y-0.5"
            >
              Apply Filters
            </button>
          </div>
        </form>
      </div>

      {children}
    </div>
  );
}
