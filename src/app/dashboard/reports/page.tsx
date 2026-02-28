import ReportsErrorState from "@/components/reports/ReportsErrorState";
import ReportsShell, { formatHours } from "@/components/reports/ReportsShell";
import { getReportsData, resolveSearchParams, type RawSearchParams } from "@/lib/reports/queries";

type ReportsOverviewPageProps = {
  searchParams?: RawSearchParams | Promise<RawSearchParams>;
};

export default async function ReportsOverviewPage({ searchParams }: ReportsOverviewPageProps) {
  const params = await resolveSearchParams(searchParams);
  const result = await getReportsData(params);

  if (!result.ok) {
    return <ReportsErrorState message={result.error} />;
  }

  const { data } = result;

  return (
    <ReportsShell
      title="Overview"
      subtitle="Snapshot metrics and top contributors for the selected date range."
      activeTab="overview"
      data={data}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Hours (This Week)
          </p>
          <p className="mt-1 text-[26px] font-extrabold text-accent">
            {formatHours(data.overview.total_hours_this_week_seconds)}h
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Hours (Selected)
          </p>
          <p className="mt-1 text-[26px] font-extrabold text-accent">
            {formatHours(data.overview.total_hours_selected_range_seconds)}h
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Crew Count
          </p>
          <p className="mt-1 text-[26px] font-extrabold text-text">
            {data.overview.total_crew_count}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Active Sites
          </p>
          <p className="mt-1 text-[26px] font-extrabold text-text">
            {data.overview.active_sites_count}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Top Projects by Hours
          </p>
          {data.overview.top_projects.length === 0 ? (
            <p className="text-[13px] text-text-muted">No project hours found for this range.</p>
          ) : (
            <div className="space-y-2">
              {data.overview.top_projects.map((project, index) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                >
                  <span className="font-semibold text-text">
                    {index + 1}. {project.name}
                  </span>
                  <span className="font-bold text-accent">{formatHours(project.seconds)}h</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Top Workers by Hours
          </p>
          {data.overview.top_workers.length === 0 ? (
            <p className="text-[13px] text-text-muted">No worker hours found for this range.</p>
          ) : (
            <div className="space-y-2">
              {data.overview.top_workers.map((worker, index) => (
                <div
                  key={worker.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                >
                  <span className="font-semibold text-text">
                    {index + 1}. {worker.name}
                  </span>
                  <span className="font-bold text-accent">{formatHours(worker.seconds)}h</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ReportsShell>
  );
}
