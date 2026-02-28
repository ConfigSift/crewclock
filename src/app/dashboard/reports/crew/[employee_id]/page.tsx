import Link from "next/link";
import ReportsErrorState from "@/components/reports/ReportsErrorState";
import ReportsShell, { formatHours } from "@/components/reports/ReportsShell";
import ActivityTimeline from "@/components/reports/ActivityTimeline";
import { getActivityTimelineData } from "@/lib/reports/activity";
import { getReportsData, resolveSearchParams, type RawSearchParams } from "@/lib/reports/queries";

type ReportsCrewDetailPageProps = {
  params: Promise<{ employee_id: string }> | { employee_id: string };
  searchParams?: RawSearchParams | Promise<RawSearchParams>;
};

export default async function ReportsCrewDetailPage({
  params,
  searchParams,
}: ReportsCrewDetailPageProps) {
  const routeParams = await params;
  const employeeId = routeParams.employee_id.trim();
  const resolvedParams = await resolveSearchParams(searchParams);
  const result = await getReportsData(resolvedParams);

  if (!result.ok) {
    return <ReportsErrorState message={result.error} />;
  }

  const { data } = result;
  const tab =
    typeof resolvedParams.tab === "string" && resolvedParams.tab === "overview"
      ? "overview"
      : "activity";

  const workerOption = data.options.workers.find((worker) => worker.id === employeeId);
  const workerSummary = data.crew.find((worker) => worker.worker_id === employeeId);
  const projectNameById = new Map(data.options.projects.map((project) => [project.id, project.name]));
  const projectList = workerSummary
    ? workerSummary.project_ids
        .map((projectId) => projectNameById.get(projectId) ?? projectId)
        .join(", ")
    : "";

  const timeline = await getActivityTimelineData({
    businessId: data.business.id,
    fromIso: data.filters.from_iso,
    toIso: data.filters.to_iso,
    projectId: data.filters.project_id,
    employeeId,
  });

  const baseSearch = new URLSearchParams();
  baseSearch.set("range", data.filters.range);
  baseSearch.set("start", data.filters.start);
  baseSearch.set("end", data.filters.end);
  if (data.filters.project_id) {
    baseSearch.set("project_id", data.filters.project_id);
  }

  const backHref = `/dashboard/reports/crew?${baseSearch.toString()}`;
  const overviewHref = `/dashboard/reports/crew/${employeeId}?${baseSearch.toString()}&tab=overview`;
  const activityHref = `/dashboard/reports/crew/${employeeId}?${baseSearch.toString()}&tab=activity`;

  return (
    <ReportsShell
      title="Crew Detail"
      subtitle="Worker-level summary and activity timeline."
      activeTab="crew"
      data={data}
    >
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
              Worker
            </p>
            <h2 className="text-[20px] font-extrabold text-text">
              {workerOption?.name ?? workerSummary?.worker_name ?? employeeId}
            </h2>
            {workerOption?.phone ? (
              <p className="text-[12px] text-text-muted">{workerOption.phone}</p>
            ) : null}
          </div>

          <Link
            href={backHref}
            className="rounded-lg border border-border bg-bg px-3 py-1.5 text-[12px] font-semibold text-text-muted hover:text-text"
          >
            Back to Crew Report
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={overviewHref}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
              tab === "overview"
                ? "border-accent/50 bg-accent/[0.12] text-accent"
                : "border-border bg-bg text-text-muted hover:text-text"
            }`}
          >
            Overview
          </Link>
          <Link
            href={activityHref}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
              tab === "activity"
                ? "border-accent/50 bg-accent/[0.12] text-accent"
                : "border-border bg-bg text-text-muted hover:text-text"
            }`}
          >
            Activity
          </Link>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          {workerSummary ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-border bg-bg p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Hours
                </p>
                <p className="mt-1 text-[22px] font-extrabold text-accent">
                  {formatHours(workerSummary.seconds)}h
                </p>
              </div>
              <div className="rounded-xl border border-border bg-bg p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Projects Worked
                </p>
                <p className="mt-1 text-[22px] font-extrabold text-text">
                  {workerSummary.projects_worked}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-bg p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Role
                </p>
                <p className="mt-1 text-[22px] font-extrabold text-text">{workerSummary.role}</p>
              </div>
              <div className="rounded-xl border border-border bg-bg p-3 sm:col-span-2 lg:col-span-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Project List
                </p>
                <p className="mt-1 text-[12px] text-text">{projectList || "No projects"}</p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-text-muted">
              No summary metrics found for this worker in the selected range.
            </p>
          )}
        </div>
      ) : (
        <>
          {!timeline.used_time_entry_events && timeline.used_time_entries_fallback ? (
            <div className="rounded-2xl border border-border bg-card p-3 text-[12px] text-text-muted">
              No `time_entry_events` found for this worker/range. Showing derived clock in/out
              events from `time_entries`.
            </div>
          ) : null}
          <ActivityTimeline
            rows={timeline.rows}
            emptyMessage="No activity found for this worker in the selected range."
          />
        </>
      )}
    </ReportsShell>
  );
}
