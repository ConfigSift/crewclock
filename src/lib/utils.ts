import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ─── Time Formatting ─────────────────────────────────
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── Period Helpers ──────────────────────────────────
export type Period = "week" | "month" | "year";

export function getPeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "week": {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      return start;
    }
    case "month": {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    case "year": {
      return new Date(now.getFullYear(), 0, 1);
    }
  }
}

export function isInPeriod(dateStr: string, period: Period): boolean {
  return new Date(dateStr) >= getPeriodStart(period);
}

// ─── Calculate total hours from entries ──────────────
export function calcTotalSeconds(
  entries: Array<{ clock_in: string; clock_out: string | null }>,
  period?: Period
): number {
  return entries.reduce((total, entry) => {
    if (period && !isInPeriod(entry.clock_in, period)) return total;
    const start = new Date(entry.clock_in).getTime();
    const end = entry.clock_out
      ? new Date(entry.clock_out).getTime()
      : Date.now();
    return total + (end - start) / 1000;
  }, 0);
}

// ─── Slugify ─────────────────────────────────────────
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
