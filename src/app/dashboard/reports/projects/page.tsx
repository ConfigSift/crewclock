import ReportsErrorState from "@/components/reports/ReportsErrorState";
import ReportsShell, { formatHours } from "@/components/reports/ReportsShell";
import { getReportsData, resolveSearchParams, type RawSearchParams } from "@/lib/reports/queries";

type ReportsProjectsPageProps = {
  searchParams?: RawSearchParams | Promise<RawSearchParams>;
};

export default async function ReportsProjectsPage({ searchParams }: ReportsProjectsPageProps) {
  const params = await resolveSearchParams(searchParams);
  const result = await getReportsData(params);

  if (!result.ok) {
    return <ReportsErrorState message={result.error} />;
  }

  const { data } = result;

  return (
    <ReportsShell
      title="Project Report"
      subtitle="Per-project hours with worker-level breakdown."
      activeTab="projects"
      data={data}
    >
      <div className="space-y-3">
        {data.projects.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-[13px] text-text-muted">
              No project activity found for the selected filters.
            </p>
          </div>
        ) : (
          data.projects.map((project) => (
            <div key={project.project_id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-[17px] font-bold text-text">{project.project_name}</h2>
                  {project.project_address && (
                    <p className="text-[12px] text-text-muted">{project.project_address}</p>
                  )}
                </div>
                <p className="text-[20px] font-extrabold text-accent">
                  {formatHours(project.seconds)}h
                </p>
              </div>

              <div className="mt-3 rounded-xl border border-border bg-bg p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Worker Breakdown
                </p>
                {project.worker_breakdown.length === 0 ? (
                  <p className="text-[12px] text-text-muted">No worker data available.</p>
                ) : (
                  <div className="space-y-2">
                    {project.worker_breakdown.map((worker) => (
                      <div key={worker.worker_id} className="flex items-center justify-between text-[13px]">
                        <span className="font-semibold text-text">{worker.worker_name}</span>
                        <span className="font-bold text-accent">{formatHours(worker.seconds)}h</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </ReportsShell>
  );
}
