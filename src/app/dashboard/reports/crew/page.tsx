import Link from "next/link";
import ReportsErrorState from "@/components/reports/ReportsErrorState";
import ReportsShell, { formatHours } from "@/components/reports/ReportsShell";
import { getReportsData, resolveSearchParams, type RawSearchParams } from "@/lib/reports/queries";

type ReportsCrewPageProps = {
  searchParams?: RawSearchParams | Promise<RawSearchParams>;
};

export default async function ReportsCrewPage({ searchParams }: ReportsCrewPageProps) {
  const params = await resolveSearchParams(searchParams);
  const result = await getReportsData(params);

  if (!result.ok) {
    return <ReportsErrorState message={result.error} />;
  }

  const { data } = result;
  const projectNameById = new Map(data.options.projects.map((project) => [project.id, project.name]));
  const baseSearch = new URLSearchParams();
  baseSearch.set("range", data.filters.range);
  baseSearch.set("start", data.filters.start);
  baseSearch.set("end", data.filters.end);
  if (data.filters.project_id) {
    baseSearch.set("project_id", data.filters.project_id);
  }

  return (
    <ReportsShell
      title="Worker Report"
      subtitle="Per-worker hours and project coverage."
      activeTab="crew"
      data={data}
    >
      <div className="rounded-2xl border border-border bg-card p-4">
        {data.crew.length === 0 ? (
          <p className="text-[13px] text-text-muted">No worker activity found for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-widest text-text-muted">
                  <th className="px-2 py-2 font-bold">Worker</th>
                  <th className="px-2 py-2 font-bold">Role</th>
                  <th className="px-2 py-2 font-bold">Hours</th>
                  <th className="px-2 py-2 font-bold">Projects Worked</th>
                  <th className="px-2 py-2 font-bold">Project List</th>
                  <th className="px-2 py-2 font-bold text-right">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.crew.map((worker) => {
                  const projectNames = worker.project_ids
                    .map((projectId) => projectNameById.get(projectId) ?? projectId)
                    .join(", ");

                  return (
                    <tr key={worker.worker_id} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-2 font-semibold text-text">
                        {worker.worker_name}
                        {worker.phone ? <p className="text-[11px] text-text-muted">{worker.phone}</p> : null}
                      </td>
                      <td className="px-2 py-2 text-text-muted">{worker.role}</td>
                      <td className="px-2 py-2 font-bold text-accent">
                        {formatHours(worker.seconds)}h
                      </td>
                      <td className="px-2 py-2 text-text">{worker.projects_worked}</td>
                      <td className="px-2 py-2 text-text-muted">
                        {projectNames || "No projects"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Link
                          href={`/dashboard/reports/crew/${worker.worker_id}?${baseSearch.toString()}&tab=activity`}
                          className="rounded-md border border-accent/40 bg-accent/[0.12] px-2 py-1 text-[11px] font-bold text-accent"
                        >
                          Activity
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportsShell>
  );
}
