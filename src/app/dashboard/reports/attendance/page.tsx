import ReportsErrorState from "@/components/reports/ReportsErrorState";
import ReportsShell, { formatDateTime, formatHours } from "@/components/reports/ReportsShell";
import { getReportsData, resolveSearchParams, type RawSearchParams } from "@/lib/reports/queries";

type ReportsAttendancePageProps = {
  searchParams?: RawSearchParams | Promise<RawSearchParams>;
};

export default async function ReportsAttendancePage({ searchParams }: ReportsAttendancePageProps) {
  const params = await resolveSearchParams(searchParams);
  const result = await getReportsData(params);

  if (!result.ok) {
    return <ReportsErrorState message={result.error} />;
  }

  const { data } = result;

  return (
    <ReportsShell
      title="Time & Attendance Audit"
      subtitle="Detailed punch log with geofence compliance flags."
      activeTab="attendance"
      data={data}
    >
      <div className="rounded-2xl border border-border bg-card p-4">
        {data.attendance.length === 0 ? (
          <p className="text-[13px] text-text-muted">No attendance entries for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-widest text-text-muted">
                  <th className="px-2 py-2 font-bold">Clock In</th>
                  <th className="px-2 py-2 font-bold">Clock Out</th>
                  <th className="px-2 py-2 font-bold">Worker</th>
                  <th className="px-2 py-2 font-bold">Project</th>
                  <th className="px-2 py-2 font-bold">Duration</th>
                  <th className="px-2 py-2 font-bold">Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.attendance.map((entry) => {
                  const flags: string[] = [];
                  if (entry.clock_in_outside_geofence) {
                    flags.push("Clock-in outside geofence");
                  }
                  if (entry.clock_out_outside_geofence) {
                    flags.push("Clock-out outside geofence");
                  }

                  return (
                    <tr key={entry.id} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-2 text-text">{formatDateTime(entry.clock_in)}</td>
                      <td className="px-2 py-2 text-text">
                        {entry.clock_out ? formatDateTime(entry.clock_out) : "Open"}
                      </td>
                      <td className="px-2 py-2 font-semibold text-text">{entry.worker_name}</td>
                      <td className="px-2 py-2 text-text-muted">{entry.project_name}</td>
                      <td className="px-2 py-2 font-bold text-accent">
                        {formatHours(entry.duration_seconds)}h
                      </td>
                      <td className="px-2 py-2">
                        {flags.length === 0 ? (
                          <span className="rounded-md border border-green-border bg-green-dark px-2 py-0.5 text-[11px] font-bold text-green">
                            Clean
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {flags.map((flag) => (
                              <span
                                key={flag}
                                className="rounded-md border border-red-border bg-red-dark px-2 py-0.5 text-[11px] font-bold text-red"
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        )}
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
