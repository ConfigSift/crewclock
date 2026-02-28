import { formatDateTime } from "@/components/reports/ReportsShell";
import type { ActivityTimelineRow } from "@/lib/reports/activity";

type ActivityTimelineProps = {
  rows: ActivityTimelineRow[];
  emptyMessage?: string;
};

function badgeLabel(type: ActivityTimelineRow["type"]): string {
  if (type === "clock_in") return "Clock In";
  if (type === "clock_out") return "Clock Out";
  if (type === "enter") return "Enter";
  return "Exit";
}

function badgeClass(type: ActivityTimelineRow["type"]): string {
  if (type === "clock_in") {
    return "border-green-border bg-green-dark text-green";
  }
  if (type === "clock_out") {
    return "border-accent/40 bg-accent/[0.12] text-accent";
  }
  if (type === "enter") {
    return "border-green-border bg-green-dark text-green";
  }
  return "border-red-border bg-red-dark text-red";
}

function dayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dayKey(value: string): string {
  return value.slice(0, 10);
}

export default function ActivityTimeline({
  rows,
  emptyMessage = "No activity found for this range.",
}: ActivityTimelineProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[13px] text-text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const grouped = rows.reduce<Map<string, ActivityTimelineRow[]>>((acc, row) => {
    const key = dayKey(row.occurred_at);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)?.push(row);
    return acc;
  }, new Map());

  const dayKeys = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-3">
      {dayKeys.map((key) => {
        const dayRows = grouped.get(key) ?? [];
        return (
          <details
            key={key}
            open
            className="rounded-2xl border border-border bg-card p-4 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="cursor-pointer select-none">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-text">{dayLabel(dayRows[0]?.occurred_at ?? key)}</p>
                <span className="text-[11px] text-text-muted">{dayRows.length} events</span>
              </div>
            </summary>

            <div className="mt-3 space-y-2">
              {dayRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-border bg-bg p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-text-muted">
                      {formatDateTime(row.occurred_at)}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${badgeClass(row.type)}`}
                    >
                      {badgeLabel(row.type)}
                    </span>
                    <span className="text-[11px] text-text-dim">{row.employee_name}</span>
                    <span className="text-[11px] text-text-dim">· {row.project_name}</span>
                  </div>

                  {row.type === "enter" || row.type === "exit" ? (
                    <p className="mt-1 text-[11px] text-text-muted">
                      {typeof row.distance_m === "number"
                        ? `Distance ${Math.round(row.distance_m)}m`
                        : "Distance unavailable"}
                      {typeof row.inside === "boolean" ? ` · inside: ${row.inside ? "yes" : "no"}` : ""}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
