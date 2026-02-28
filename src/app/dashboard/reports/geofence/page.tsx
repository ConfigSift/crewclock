import ReportsErrorState from "@/components/reports/ReportsErrorState";
import ReportsShell from "@/components/reports/ReportsShell";
import { getReportsData, resolveSearchParams, type RawSearchParams } from "@/lib/reports/queries";

type ReportsGeofencePageProps = {
  searchParams?: RawSearchParams | Promise<RawSearchParams>;
};

export default async function ReportsGeofencePage({ searchParams }: ReportsGeofencePageProps) {
  const params = await resolveSearchParams(searchParams);
  const result = await getReportsData(params);

  if (!result.ok) {
    return <ReportsErrorState message={result.error} />;
  }

  const { data } = result;

  return (
    <ReportsShell
      title="Geofence Compliance"
      subtitle="Punch-ins and punch-outs measured against each site geofence."
      activeTab="geofence"
      data={data}
    >
      <div className="rounded-2xl border border-border bg-card p-4">
        {data.geofence.length === 0 ? (
          <p className="text-[13px] text-text-muted">No geofence data available for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-widest text-text-muted">
                  <th className="px-2 py-2 font-bold">Project</th>
                  <th className="px-2 py-2 font-bold">% Punches Inside</th>
                  <th className="px-2 py-2 font-bold">Punches Inside / Total</th>
                  <th className="px-2 py-2 font-bold"># Exits</th>
                  <th className="px-2 py-2 font-bold">Minutes Outside</th>
                </tr>
              </thead>
              <tbody>
                {data.geofence.map((row) => (
                  <tr key={row.project_id} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-2 font-semibold text-text">
                      {row.project_name}
                      {row.project_address ? (
                        <p className="text-[11px] text-text-muted">{row.project_address}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 font-bold text-accent">
                      {row.percent_inside === null ? "--" : `${row.percent_inside}%`}
                    </td>
                    <td className="px-2 py-2 text-text">
                      {row.punches_inside} / {row.punches_total}
                    </td>
                    <td className="px-2 py-2 text-text">{row.exits}</td>
                    <td className="px-2 py-2 text-text-muted">
                      {row.minutes_outside === null
                        ? "Pending geofence events"
                        : row.minutes_outside}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportsShell>
  );
}
