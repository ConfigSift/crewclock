import type { ReactNode } from "react";

export default function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4 lg:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-text">{title}</h3>
        {subtitle ? <p className="text-xs text-text-muted mt-0.5">{subtitle}</p> : null}
      </div>
      <div className="h-[260px]">{children}</div>
    </div>
  );
}
