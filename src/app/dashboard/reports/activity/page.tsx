import ReportsErrorState from "@/components/reports/ReportsErrorState";
import ReportsShell from "@/components/reports/ReportsShell";
import ActivityTimeline from "@/components/reports/ActivityTimeline";
import { getActivityTimelineData } from "@/lib/reports/activity";
import { getReportsData, resolveSearchParams, type RawSearchParams } from "@/lib/reports/queries";

type ReportsActivityPageProps = {
  searchParams?: RawSearchParams | Promise<RawSearchParams>;
};

export default async function ReportsActivityPage({ searchParams }: ReportsActivityPageProps) {
  const params = await resolveSearchParams(searchParams);
  const result = await getReportsData(params);

  if (!result.ok) {
    return <ReportsErrorState message={result.error} />;
  }

  const { data } = result;
  const timeline = await getActivityTimelineData({
    businessId: data.business.id,
    fromIso: data.filters.from_iso,
    toIso: data.filters.to_iso,
    workerId: data.filters.worker_id,
    projectId: data.filters.project_id,
  });

  return (
    <ReportsShell
      title="Activity Timeline"
      subtitle="Unified clock and geofence event feed for the selected filters."
      activeTab="activity"
      data={data}
    >
      {!timeline.used_time_entry_events && timeline.used_time_entries_fallback ? (
        <div className="rounded-2xl border border-border bg-card p-3 text-[12px] text-text-muted">
          No `time_entry_events` found for this range. Showing derived clock in/out events from
          `time_entries`.
        </div>
      ) : null}

      <ActivityTimeline rows={timeline.rows} />
    </ReportsShell>
  );
}
