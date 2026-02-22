"use client";

import ClockPanel from "@/components/clock/ClockPanel";
import { useAppStore } from "@/lib/store";
import { formatTime } from "@/lib/utils";

export default function DashboardClockPage() {
  const { activeEntry, projects } = useAppStore();
  const activeProject = activeEntry
    ? projects.find((project) => project.id === activeEntry.project_id)
    : null;

  return (
    <div className="animate-fade-in">
      <h1 className="text-[22px] font-extrabold tracking-tight mb-1">My Time</h1>
      <p className="text-sm text-text-muted mb-4">
        {activeEntry && activeProject
          ? `Clocked in on ${activeProject.name} since ${formatTime(activeEntry.clock_in)}`
          : "Not clocked in. Choose a project and start your shift."}
      </p>
      <ClockPanel />
    </div>
  );
}
